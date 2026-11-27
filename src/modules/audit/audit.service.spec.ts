import { BadRequestException } from '@nestjs/common';
import {
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

import { AuditService } from './audit.service.js';
import {
  AUDIT_ACTIONS,
  AUDIT_ENTITY_TYPES,
} from './audit.constants.js';

describe('AuditService', () => {
  let service: AuditService;
  let tx: any;

  beforeEach(() => {
    service = new AuditService();

    tx = {
      auditLog: {
        create: vi.fn().mockResolvedValue({
          id: 'audit-id',
          action: AUDIT_ACTIONS.TRANSFER_COMPLETED,
          entityType: AUDIT_ENTITY_TYPES.TRANSFER,
        }),
      },
    };
  });

  it('should create an audit log', async () => {
    const input = {
      actorId: '00000000-0000-4000-8000-000000000001',
      action: AUDIT_ACTIONS.TRANSFER_COMPLETED,
      entityType: AUDIT_ENTITY_TYPES.TRANSFER,
      entityId: '00000000-0000-4000-8000-000000000002',
      metadata: {
        amount: '75000',
        currency: 'IDR',
      },
    };

    const result = await service.create(tx, input);

    expect(result.id).toBe('audit-id');

    expect(tx.auditLog.create).toHaveBeenCalledWith({
      data: {
        actorId: input.actorId,
        action: input.action,
        entityType: input.entityType,
        entityId: input.entityId,
        metadata: input.metadata,
        ipAddress: null,
        userAgent: null,
      },
    });
  });

  it('should create an audit log without optional fields', async () => {
    await service.create(tx, {
      action: AUDIT_ACTIONS.USER_LOGIN,
      entityType: AUDIT_ENTITY_TYPES.USER,
    });

    expect(tx.auditLog.create).toHaveBeenCalledWith({
      data: {
        actorId: null,
        action: AUDIT_ACTIONS.USER_LOGIN,
        entityType: AUDIT_ENTITY_TYPES.USER,
        entityId: null,
        ipAddress: null,
        userAgent: null,
      },
    });
  });

  it('should trim action and entity type', async () => {
    await service.create(tx, {
      action: '  USER_LOGIN  ',
      entityType: '  USER  ',
    });

    expect(tx.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: 'USER_LOGIN',
          entityType: 'USER',
        }),
      }),
    );
  });

  it('should reject empty action', async () => {
    await expect(
      service.create(tx, {
        action: '   ',
        entityType: 'USER',
      }),
    ).rejects.toThrow(BadRequestException);

    expect(tx.auditLog.create).not.toHaveBeenCalled();
  });

  it('should reject empty entity type', async () => {
    await expect(
      service.create(tx, {
        action: 'USER_LOGIN',
        entityType: '   ',
      }),
    ).rejects.toThrow(BadRequestException);

    expect(tx.auditLog.create).not.toHaveBeenCalled();
  });

  it('should reject action exceeding 100 characters', async () => {
    await expect(
      service.create(tx, {
        action: 'A'.repeat(101),
        entityType: 'USER',
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('should reject entity type exceeding 100 characters', async () => {
    await expect(
      service.create(tx, {
        action: 'USER_LOGIN',
        entityType: 'A'.repeat(101),
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('should reject IP address exceeding 45 characters', async () => {
    await expect(
      service.create(tx, {
        action: 'USER_LOGIN',
        entityType: 'USER',
        ipAddress: '1'.repeat(46),
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('should reject user agent exceeding 500 characters', async () => {
    await expect(
      service.create(tx, {
        action: 'USER_LOGIN',
        entityType: 'USER',
        userAgent: 'A'.repeat(501),
      }),
    ).rejects.toThrow(BadRequestException);
  });
});