import { COOKIE_NAME } from "@shared/const";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, router } from "./_core/trpc";
import {
  isDbConfigured,
  readEventsFromLog,
  getPool,
} from "./db";
import {
  appendEventWithDeltas,
  conflictSetAt,
  readBranchEventsWithAncestry,
} from "./conflictDeltas";
import { replayEvents } from "./events";

const appendEventInput = z.object({
  branchId: z.string().default("main"),
  type: z.string(),
  payload: z.record(z.string(), z.any()),
  source: z.string().default("api"),
  createdAt: z.string().optional(),
});

const readEventsInput = z
  .object({
    branchId: z.string().default("main"),
    fromOffset: z.number().optional(),
    upToOffset: z.number().optional(),
    limit: z.number().default(1000),
  })
  .default({ branchId: "main", limit: 1000 });

const stateInput = z
  .object({
    branchId: z.string().default("main"),
    offset: z.number().optional(),
  })
  .default({ branchId: "main" });

const conflictsAtInput = z.object({
  branchId: z.string().default("main"),
  offset: z.number(),
});

export const appRouter = router({
  system: systemRouter,
  auth: router({
    me: publicProcedure.query((opts) => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return {
        success: true,
      } as const;
    }),
  }),

  events: router({
    appendEvent: publicProcedure
      .input(appendEventInput)
      .mutation(async ({ input }) => {
        if (!isDbConfigured()) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: "Database is not configured. DATABASE_URL is missing.",
          });
        }
        try {
          return await appendEventWithDeltas(input);
        } catch (error) {
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message:
              error instanceof Error
                ? error.message
                : "Failed to append event with deltas",
          });
        }
      }),

    // Alias for appendEvent
    append: publicProcedure
      .input(appendEventInput)
      .mutation(async ({ input }) => {
        if (!isDbConfigured()) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: "Database is not configured. DATABASE_URL is missing.",
          });
        }
        try {
          return await appendEventWithDeltas(input);
        } catch (error) {
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message:
              error instanceof Error
                ? error.message
                : "Failed to append event with deltas",
          });
        }
      }),

    readEvents: publicProcedure
      .input(readEventsInput)
      .query(async ({ input }) => {
        if (!isDbConfigured()) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: "Database is not configured. DATABASE_URL is missing.",
          });
        }
        try {
          return await readEventsFromLog(input);
        } catch (error) {
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message:
              error instanceof Error
                ? error.message
                : "Failed to read events from log",
          });
        }
      }),

    read: publicProcedure
      .input(readEventsInput)
      .query(async ({ input }) => {
        if (!isDbConfigured()) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: "Database is not configured. DATABASE_URL is missing.",
          });
        }
        try {
          return await readEventsFromLog(input);
        } catch (error) {
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message:
              error instanceof Error
                ? error.message
                : "Failed to read events from log",
          });
        }
      }),

    state: publicProcedure.input(stateInput).query(async ({ input }) => {
      if (!isDbConfigured()) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Database is not configured. DATABASE_URL is missing.",
        });
      }
      try {
        const pool = getPool();
        if (!pool) throw new Error("Pool unavailable");

        const events = await readBranchEventsWithAncestry(
          pool,
          input.branchId,
          input.offset
        );
        const plan = replayEvents(events);
        const issues = await conflictSetAt(input.branchId, input.offset, pool);

        const latestOffset =
          input.offset !== undefined
            ? input.offset
            : events.length > 0
            ? Number(events[events.length - 1].offset)
            : 0;

        return {
          branchId: input.branchId,
          offset: latestOffset,
          plan,
          issues,
        };
      } catch (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error
              ? error.message
              : "Failed to retrieve branch state",
        });
      }
    }),

    conflictsAt: publicProcedure
      .input(conflictsAtInput)
      .query(async ({ input }) => {
        if (!isDbConfigured()) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: "Database is not configured. DATABASE_URL is missing.",
          });
        }
        try {
          const pool = getPool();
          if (!pool) throw new Error("Pool unavailable");

          const issues = await conflictSetAt(input.branchId, input.offset, pool);
          return {
            branchId: input.branchId,
            offset: input.offset,
            issues,
          };
        } catch (error) {
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message:
              error instanceof Error
                ? error.message
                : "Failed to retrieve conflicts at offset",
          });
        }
      }),
  }),
});

export type AppRouter = typeof appRouter;
