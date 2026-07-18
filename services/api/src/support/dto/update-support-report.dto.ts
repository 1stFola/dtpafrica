import { IsIn, IsOptional, IsString, MaxLength } from "class-validator";

export const SUPPORT_REPORT_STATUSES = [
  "open",
  "triaged",
  "waiting_on_human",
  "resolved",
  "closed",
] as const;

export const SUPPORT_PLAYBOOK_OUTCOMES = [
  "not_reviewed",
  "confirmed",
  "updated",
  "new_entry_needed",
] as const;

export class UpdateSupportReportDto {
  @IsOptional()
  @IsString()
  @IsIn([...SUPPORT_REPORT_STATUSES])
  status?: string;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  adminNotes?: string;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  resolutionSummary?: string;

  @IsOptional()
  @IsString()
  @IsIn([...SUPPORT_PLAYBOOK_OUTCOMES])
  playbookOutcome?: string;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  playbookProposal?: string;
}
