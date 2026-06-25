export class UpsertAdminTeamDto {
  competitionId!: string;
  name!: string;
  slug?: string;
  shortName?: string;
  logoUrl?: string;
  city?: string;
  groupKey?: string;
}
