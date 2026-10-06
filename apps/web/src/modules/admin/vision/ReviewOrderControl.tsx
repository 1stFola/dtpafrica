import type { ReviewQueueOrder } from "@dtp/vision-contracts";
import { useId } from "react";

export function ReviewOrderControl({ order, onChange }: { order: ReviewQueueOrder; onChange: (order: ReviewQueueOrder) => void }) {
  const id = useId();
  return <div className="vision-review-order">
    <label htmlFor={id}>Review order</label>
    <select id={id} value={order} onChange={(event) => onChange(event.target.value === "confidence" ? "confidence" : "oldest")}>
      <option value="confidence">Lowest confidence first</option>
      <option value="oldest">Oldest first</option>
    </select>
  </div>;
}
