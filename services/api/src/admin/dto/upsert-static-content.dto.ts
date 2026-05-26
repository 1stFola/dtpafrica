import { IsString } from "class-validator";

export class UpsertStaticContentDto {
  @IsString()
  value!: string;
}
