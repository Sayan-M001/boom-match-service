import httpStatus from "http-status";
import type { NextFunction, Request, Response } from "express";
import { Role } from "@prisma/client";
import config from "../config/config";
import prisma from "../client";
import ApiError from "../utils/ApiError";

type VerifiedBoomUser = {
  id: number;
  email: string;
  name?: string | null;
  role?: Role;
  isEmailVerified?: boolean;
  profilePictureKey?: string | null;
};

const getBearerToken = (req: Request) => {
  const authorization = req.headers.authorization;
  if (!authorization?.toLowerCase().startsWith("bearer ")) return null;
  return authorization.slice("bearer ".length).trim();
};

const verifyWithBoomBackend = async (
  token: string,
): Promise<VerifiedBoomUser> => {
  if (!config.boomBackendUrl) {
    throw new ApiError(
      httpStatus.INTERNAL_SERVER_ERROR,
      "BOOM_BACKEND_URL is required",
    );
  }

  const response = await fetch(`${config.boomBackendUrl}/v1/auth/verify`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  if (!response.ok) {
    throw new ApiError(httpStatus.UNAUTHORIZED, "Please authenticate");
  }

  const user = (await response.json()) as VerifiedBoomUser;
  if (!user?.id || !user.email) {
    throw new ApiError(
      httpStatus.UNAUTHORIZED,
      "Invalid auth verification response",
    );
  }

  return user;
};

const mirrorUser = async (verifiedUser: VerifiedBoomUser) => {
  return prisma.user.upsert({
    where: { id: verifiedUser.id },
    create: {
      id: verifiedUser.id,
      email: verifiedUser.email,
      name: verifiedUser.name ?? null,
      role: verifiedUser.role ?? Role.USER,
      isEmailVerified: verifiedUser.isEmailVerified ?? true,
      profilePictureKey: verifiedUser.profilePictureKey ?? null,
    },
    update: {
      email: verifiedUser.email,
      name: verifiedUser.name ?? null,
      role: verifiedUser.role ?? Role.USER,
      isEmailVerified: verifiedUser.isEmailVerified ?? true,
      profilePictureKey: verifiedUser.profilePictureKey ?? null,
    },
  });
};

export const auth =
  () => async (req: Request, _res: Response, next: NextFunction) => {
    try {
      const token = getBearerToken(req);
      if (!token) {
        throw new ApiError(httpStatus.UNAUTHORIZED, "Please authenticate");
      }

      req.user = await mirrorUser(await verifyWithBoomBackend(token));
      next();
    } catch (error) {
      next(error);
    }
  };

export const requireBoomMatchAdmin = (
  req: Request,
  _res: Response,
  next: NextFunction,
) => {
  const email = req.user?.email.toLowerCase();
  if (!email || !config.boomMatchAdminEmails.includes(email)) {
    next(new ApiError(httpStatus.FORBIDDEN, "Forbidden"));
    return;
  }

  next();
};
