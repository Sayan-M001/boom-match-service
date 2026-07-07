import type { NextFunction, Request, Response } from "express";
import type { ObjectSchema } from "joi";
import httpStatus from "http-status";
import ApiError from "../utils/ApiError";

type ValidationSchema = {
  body?: ObjectSchema;
  query?: ObjectSchema;
  params?: ObjectSchema;
};

const validate =
  (schema: ValidationSchema) =>
  (req: Request, _res: Response, next: NextFunction) => {
    const targets: Array<keyof ValidationSchema> = ["params", "query", "body"];

    for (const target of targets) {
      if (!schema[target]) continue;

      const { value, error } = schema[target]!.validate(req[target], {
        abortEarly: false,
        allowUnknown: true,
        stripUnknown: true,
      });

      if (error) {
        next(
          new ApiError(
            httpStatus.BAD_REQUEST,
            error.details.map((detail) => detail.message).join(", "),
          ),
        );
        return;
      }

      req[target] = value;
    }

    next();
  };

export default validate;
