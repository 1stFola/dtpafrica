import {
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  MinLength,
} from "class-validator";
import { VISION_MODEL_TASKS, type VisionModelTask } from "@dtp/vision-contracts";

export class CreateModelDto {
  /** Stable handle, e.g. `detector/torchvision-fasterrcnn-coco`. Never renamed. */
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  @Matches(/^[a-z0-9][a-z0-9._/-]*$/, {
    message: "key must be lower-case letters, digits, dots, dashes, underscores or slashes",
  })
  key!: string;

  @IsIn(VISION_MODEL_TASKS as unknown as string[])
  task!: VisionModelTask;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  description?: string;
}

export class RegisterModelVersionDto {
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  @Matches(/^[A-Za-z0-9][A-Za-z0-9._+-]*$/)
  version!: string;

  /**
   * The commit the model is reproducible from. For a pretrained baseline that is
   * the commit of the code that loads and maps it; for a trained model, the commit
   * of the training run.
   */
  @IsString()
  @Matches(/^[0-9a-f]{7,64}$/i, { message: "gitCommit must be a hex commit id" })
  gitCommit!: string;

  /** Object key of the config that produced this version. */
  @IsString()
  @MinLength(1)
  @MaxLength(1024)
  configKey!: string;

  /** Image tag the version runs in, e.g. `dtp-vision-engine:0.1`. */
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  workerImage!: string;

  /**
   * Required, not optional. The OSS register (docs/licenses/OSS_REGISTER.md) says
   * nothing ships without an entry; this is the entry's position as it applies to
   * these weights -- code, weights and pretraining data each named. A blank note is
   * refused rather than defaulted, because "we'll fill it in later" is how an AGPL
   * dependency reaches production.
   */
  @IsString()
  @MinLength(10)
  @MaxLength(8000)
  licenceNote!: string;

  /** The frozen DTP dataset this was trained on. Null for a pretrained baseline. */
  @IsOptional()
  @IsUUID()
  datasetVersionId?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(1024)
  weightsKey?: string;

  /**
   * SHA-256 of the weights file, if known at registration. If omitted, the first
   * worker that runs this version reports the checksum of the weights it loaded and
   * the control plane records it; every later run must match.
   */
  @IsOptional()
  @IsString()
  @Matches(/^[0-9a-f]{64}$/i, { message: "weightsChecksum must be a SHA-256 hex digest" })
  weightsChecksum?: string;
}
