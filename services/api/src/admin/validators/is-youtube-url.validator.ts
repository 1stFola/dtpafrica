import {
  registerDecorator,
  type ValidationArguments,
  type ValidationOptions,
} from "class-validator";
import { isYoutubeUrl } from "../../shared/media-url";

/**
 * A YouTube link with a readable video id: watch, youtu.be, embed, shorts or `/live/<id>`.
 * Narrower than `IsVideoMediaUrl` on purpose -- a live stream is embedded as a player,
 * and only YouTube ids can be turned into one.
 */
export function IsYoutubeUrl(options?: ValidationOptions) {
  return function decorate(object: object, propertyName: string) {
    registerDecorator({
      name: "isYoutubeUrl",
      target: object.constructor,
      propertyName,
      options: {
        message: "Must be a YouTube link (youtube.com/watch, youtu.be or youtube.com/live)",
        ...options,
      },
      validator: {
        validate(value: unknown) {
          return typeof value === "string" && isYoutubeUrl(value);
        },
        defaultMessage(args: ValidationArguments) {
          return `${args.property} must be a YouTube link (youtube.com/watch, youtu.be or youtube.com/live)`;
        },
      },
    });
  };
}
