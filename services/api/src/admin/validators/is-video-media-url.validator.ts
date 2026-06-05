import {
  registerDecorator,
  type ValidationArguments,
  type ValidationOptions,
} from "class-validator";
import { isAllowedVideoMediaUrl } from "../../shared/media-url";

export function IsVideoMediaUrl(options?: ValidationOptions) {
  return function decorate(object: object, propertyName: string) {
    registerDecorator({
      name: "isVideoMediaUrl",
      target: object.constructor,
      propertyName,
      options: {
        message:
          "Video URL must be a valid YouTube, Google Drive, or https link",
        ...options,
      },
      validator: {
        validate(value: unknown) {
          return typeof value === "string" && isAllowedVideoMediaUrl(value);
        },
        defaultMessage(args: ValidationArguments) {
          return `${args.property} must be a valid YouTube, Google Drive, or https video link`;
        },
      },
    });
  };
}
