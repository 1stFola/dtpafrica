"""Fine-tune torchvision Faster R-CNN on decoded frames (docs/vision/102).

Imported only inside the `train` stage, so the CPU image can load the stage registry
without torch. The baseline is the COCO-pretrained `fasterrcnn_resnet50_fpn` with its
box head replaced by one for the contract's classes; everything else is torchvision's
reference recipe, small enough to read: SGD with momentum, a linear warm-up over the
first epoch, the learning rate cut tenfold two thirds of the way through, horizontal
flips, and mixed precision on CUDA.

Everything random is seeded from the job's seed, so a rerun on the same data and image
is the same run.
"""

from __future__ import annotations

import logging
import random
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Callable, Sequence

import torch
import torchvision
from torch.utils.data import DataLoader, Dataset
from torchvision.models.detection import FasterRCNN_ResNet50_FPN_Weights, fasterrcnn_resnet50_fpn
from torchvision.models.detection.faster_rcnn import FastRCNNPredictor
from torchvision.io import read_image

from .evaluate import Prediction
from .train_data import Item

log = logging.getLogger(__name__)

#: Boxes below this score are not kept for evaluation; AP needs the low ones too.
EVAL_MIN_SCORE = 0.05


@dataclass
class FitResult:
    weights: Path
    epoch_losses: list[float]
    #: Val predictions per asset per 1-based frame, normalised to the frame.
    predictions: dict[str, dict[int, list[Prediction]]]
    gpu_seconds: float | None
    device: str
    base_weights_sha256: str | None


class _Frames(Dataset):
    def __init__(self, items: Sequence[Item], flip: bool, rng: random.Random):
        self.items = list(items)
        self.flip = flip
        self.rng = rng

    def __len__(self) -> int:
        return len(self.items)

    def __getitem__(self, index: int):
        item = self.items[index]
        image = read_image(str(item.image)).float() / 255.0
        boxes = torch.tensor(item.boxes, dtype=torch.float32).reshape(-1, 4)
        if self.flip and self.rng.random() < 0.5:
            image = image.flip(-1)
            width = image.shape[-1]
            if boxes.numel():
                boxes = torch.stack([width - boxes[:, 2], boxes[:, 1], width - boxes[:, 0], boxes[:, 3]], dim=1)
        target = {"boxes": boxes, "labels": torch.tensor(item.labels, dtype=torch.int64)}
        return image, target


def _collate(batch):
    return tuple(zip(*batch))


def build_model(num_classes: int, min_size: int, max_size: int):
    """COCO Faster R-CNN with a fresh head: `num_classes` contract classes plus background."""
    weights = FasterRCNN_ResNet50_FPN_Weights.DEFAULT
    model = fasterrcnn_resnet50_fpn(weights=weights, min_size=min_size, max_size=max_size)
    in_features = model.roi_heads.box_predictor.cls_score.in_features
    model.roi_heads.box_predictor = FastRCNNPredictor(in_features, num_classes + 1)
    return model, weights


def fit(
    train: Sequence[Item],
    val: Sequence[Item],
    classes: Sequence[str],
    epochs: int,
    batch_size: int,
    learning_rate: float,
    seed: int,
    min_size: int,
    max_size: int,
    out_dir: Path,
    on_progress: Callable[[str, float], None] = lambda stage, fraction: None,
    weights_sha256: Callable[[str], str | None] = lambda url: None,
) -> FitResult:
    random.seed(seed)
    torch.manual_seed(seed)
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    model, weights = build_model(len(classes), min_size, max_size)
    base_sha = weights_sha256(weights.url)
    model.to(device)

    loader = DataLoader(
        _Frames(train, flip=True, rng=random.Random(seed)),
        batch_size=batch_size,
        shuffle=True,
        generator=torch.Generator().manual_seed(seed),
        collate_fn=_collate,
        num_workers=0,
    )
    params = [p for p in model.parameters() if p.requires_grad]
    optimizer = torch.optim.SGD(params, lr=learning_rate, momentum=0.9, weight_decay=1e-4)
    steps_per_epoch = max(1, len(loader))
    warmup = steps_per_epoch
    cut_at = max(1, (2 * epochs) // 3) * steps_per_epoch

    def lr_at(step: int) -> float:
        scale = min(1.0, (step + 1) / warmup) * (0.1 if step >= cut_at else 1.0)
        return learning_rate * scale

    use_amp = device.type == "cuda"
    scaler = torch.amp.GradScaler("cuda", enabled=use_amp)
    started = time.monotonic()
    losses: list[float] = []
    step = 0
    model.train()
    for epoch in range(epochs):
        total = 0.0
        for images, targets in loader:
            images = [i.to(device) for i in images]
            targets = [{k: v.to(device) for k, v in t.items()} for t in targets]
            for group in optimizer.param_groups:
                group["lr"] = lr_at(step)
            with torch.autocast(device_type=device.type, enabled=use_amp):
                loss = sum(model(images, targets).values())
            optimizer.zero_grad(set_to_none=True)
            scaler.scale(loss).backward()
            scaler.step(optimizer)
            scaler.update()
            total += float(loss.detach())
            step += 1
            on_progress("train", step / (epochs * steps_per_epoch))
        losses.append(total / steps_per_epoch)
        log.info("epoch %d/%d mean loss %.4f", epoch + 1, epochs, losses[-1])

    model.eval()
    predictions: dict[str, dict[int, list[Prediction]]] = {}
    with torch.no_grad():
        for index, item in enumerate(val):
            image = read_image(str(item.image)).float() / 255.0
            height, width = image.shape[-2:]
            out = model([image.to(device)])[0]
            preds: list[Prediction] = []
            for box, label, score in zip(out["boxes"].tolist(), out["labels"].tolist(), out["scores"].tolist()):
                if score < EVAL_MIN_SCORE or not 1 <= label <= len(classes):
                    continue
                x1, y1, x2, y2 = box
                preds.append(Prediction(cls=classes[label - 1], confidence=float(score),
                                        box=(x1 / width, y1 / height, (x2 - x1) / width, (y2 - y1) / height)))
            predictions.setdefault(item.asset_id, {})[item.frame_number] = preds
            on_progress("evaluate", (index + 1) / max(1, len(val)))
    gpu_seconds = time.monotonic() - started if device.type == "cuda" else None

    out_dir.mkdir(parents=True, exist_ok=True)
    weights_path = out_dir / "weights.pt"
    torch.save(model.state_dict(), weights_path)
    return FitResult(weights=weights_path, epoch_losses=losses, predictions=predictions, gpu_seconds=gpu_seconds,
                     device=str(device), base_weights_sha256=base_sha)


def versions() -> tuple[str, str]:
    return torch.__version__, torchvision.__version__
