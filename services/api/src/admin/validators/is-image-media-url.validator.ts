import {
  registerDecorator,
  type ValidationArguments,
  type ValidationOptions,
} from "class-validator";
import { isAllowedImageMediaUrl } from "../../shared/media-url";

export function IsImageMediaUrl(options?: ValidationOptions) {
  return function decorate(object: object, propertyName: string) {
    registerDecorator({
      name: "isImageMediaUrl",
      target: object.constructor,
      propertyName,
      options: {
        message: "Image URL must be a valid https link (including Google Photos)",
        ...options,
      },
      validator: {
        validate(value: unknown) {
          if (value == null || value === "") return true;
          return typeof value === "string" && isAllowedImageMediaUrl(value);
        },
        defaultMessage(args: ValidationArguments) {
          return `${args.property} must be a valid image URL`;
        },
      },
    });
  };
}
