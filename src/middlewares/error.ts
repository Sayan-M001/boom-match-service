import httpStatus from "http-status";
import type { ErrorRequestHandler } from "express";
import ApiError from "../utils/ApiError";

export const errorConverter: ErrorRequestHandler = (err, _req, _res, next) => {
  if (err instanceof ApiError) {
    next(err);
    return;
  }

  next(
    new ApiError(
      httpStatus.INTERNAL_SERVER_ERROR,
      err.message || "Internal server error",
    ),
  );
};

export const errorHandler: ErrorRequestHandler = (
  err: ApiError,
  _req,
  res,
  _next,
) => {
  res.status(err.statusCode || httpStatus.INTERNAL_SERVER_ERROR).send({
    message: err.message || "Internal server error",
  });
};
