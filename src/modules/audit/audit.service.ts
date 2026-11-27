import {
  BadRequestException,
  Injectable,
} from '@nestjs/common';

import { Prisma } from '../../generated/prisma/client.js';

export interface CreateAuditLogInput {
  actorId?: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  metadata?: Prisma.InputJsonValue;
  ipAddress?: string | null;
  userAgent?: string | null;
}

@Injectable()
export class AuditService {
  async create(
    tx: Prisma.TransactionClient,
    input: CreateAuditLogInput,
  ) {
    this.validateInput(input);

    return tx.auditLog.create({
      data: {
        actorId: input.actorId ?? null,
        action: input.action.trim(),
        entityType: input.entityType.trim(),
        entityId: input.entityId ?? null,
        ...(input.metadata !== undefined
          ? { metadata: input.metadata }
          : {}),
        ipAddress: input.ipAddress ?? null,
        userAgent: input.userAgent ?? null,
      },
    });
  }

  private validateInput(
    input: CreateAuditLogInput,
  ): void {
    if (!input.action?.trim()) {
      throw new BadRequestException(
        'Audit action is required',
      );
    }

    if (input.action.trim().length > 100) {
      throw new BadRequestException(
        'Audit action must not exceed 100 characters',
      );
    }

    if (!input.entityType?.trim()) {
      throw new BadRequestException(
        'Audit entity type is required',
      );
    }

    if (input.entityType.trim().length > 100) {
      throw new BadRequestException(
        'Audit entity type must not exceed 100 characters',
      );
    }

    if (
      input.ipAddress &&
      input.ipAddress.length > 45
    ) {
      throw new BadRequestException(
        'IP address must not exceed 45 characters',
      );
    }

    if (
      input.userAgent &&
      input.userAgent.length > 500
    ) {
      throw new BadRequestException(
        'User agent must not exceed 500 characters',
      );
    }
  }
}