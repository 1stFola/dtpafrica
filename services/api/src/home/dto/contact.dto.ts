import { IsEmail, IsOptional, IsString, MinLength } from "class-validator";

export class ContactDto {
  @IsString()
  @MinLength(1)
  name!: string;

  @IsEmail()
  email!: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsString()
  subject?: string;

  @IsString()
  @MinLength(10)
  message!: string;
}
