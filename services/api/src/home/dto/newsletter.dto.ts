import { IsEmail } from "class-validator";

export class NewsletterDto {
  @IsEmail()
  email!: string;
}
