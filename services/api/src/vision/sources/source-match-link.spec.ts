import 'reflect-metadata';
import { validate } from 'class-validator';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CreateSourceDto } from './dto/sources.dto';
import { VisionSourcesService } from './sources.service';

const partnerId = '11111111-1111-4111-8111-111111111111';
const legacyId = '00000000-0000-4000-8jc0-000000000301';
const competitionId = '22222222-2222-4222-8222-222222222222';
const prisma = { visionSourcePartner: { findUnique: vi.fn() }, sbMatch: { findUnique: vi.fn() }, sbCompetition: { findUnique: vi.fn() }, visionSourceVideoRecord: { create: vi.fn() } };
// The 1XCup 2026 competition's ScoreBoard id: text in a UUID's shape, but not a UUID.
const legacyCompetitionId = '00000000-0000-4000-81xc-000000000000';
const audit = { record: vi.fn() };
let service: VisionSourcesService;
beforeEach(() => {
  vi.resetAllMocks();
  prisma.visionSourcePartner.findUnique.mockResolvedValue({ id: partnerId, isActive: true });
  prisma.sbMatch.findUnique.mockResolvedValue({ id: legacyId, competitionId });
  prisma.sbCompetition.findUnique.mockImplementation(async ({ where }) => ({ id: where.id }));
  prisma.visionSourceVideoRecord.create.mockImplementation(async ({ data }) => ({ id: 'source', ...data }));
  service = new VisionSourcesService(prisma as never, {} as never, {} as never, audit as never, {} as never, {} as never, {} as never);
});

describe('linking footage to an existing ScoreBoard match', () => {
  it('accepts legacy text IDs and UUIDs, while refusing empty, oversized and non-string values', async () => {
    for (const sbMatchId of [legacyId, competitionId, undefined]) {
      const dto = Object.assign(new CreateSourceDto(), { partnerId, sourceQualityRank: 'authorized_export', sbMatchId });
      expect(await validate(dto)).toEqual([]);
    }
    for (const sbMatchId of ['', 'x'.repeat(201), 42]) {
      const dto = Object.assign(new CreateSourceDto(), { partnerId, sourceQualityRank: 'authorized_export', sbMatchId });
      expect((await validate(dto)).some(e => e.property === 'sbMatchId')).toBe(true);
    }
  });
  it('preserves a legacy match ID after checking the referenced match', async () => {
    const row = await service.createSource({ partnerId, sourceQualityRank: 'authorized_export', sbMatchId: legacyId, sbCompetitionId: competitionId });
    expect(prisma.sbMatch.findUnique).toHaveBeenCalledWith({ where: { id: legacyId }, select: { id: true, competitionId: true } });
    expect(row.sbMatchId).toBe(legacyId);
    expect(row.acquisitionStatus).toBe('catalogued');
    expect(audit.record).toHaveBeenCalledOnce();
  });
  it('refuses a missing match before storing a source or audit row', async () => {
    prisma.sbMatch.findUnique.mockResolvedValue(null);
    await expect(service.createSource({ partnerId, sourceQualityRank: 'authorized_export', sbMatchId: legacyId })).rejects.toMatchObject({ status: 404 });
    expect(prisma.visionSourceVideoRecord.create).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });
  it('refuses a match from another competition before storing a source', async () => {
    const error = await service.createSource({ partnerId, sourceQualityRank: 'authorized_export', sbMatchId: legacyId, sbCompetitionId: partnerId }).catch(e => e.getResponse());
    expect(error).toMatchObject({ statusCode: 400, error: 'SourceMatchCompetitionMismatch' });
    expect(prisma.visionSourceVideoRecord.create).not.toHaveBeenCalled();
  });
  it('accepts a legacy text competition ID, and refuses empty, oversized and non-string ones', async () => {
    for (const sbCompetitionId of [legacyCompetitionId, competitionId, undefined]) {
      const dto = Object.assign(new CreateSourceDto(), { partnerId, sourceQualityRank: 'authorized_export', sbCompetitionId });
      expect(await validate(dto)).toEqual([]);
    }
    for (const sbCompetitionId of ['', 'x'.repeat(201), 42]) {
      const dto = Object.assign(new CreateSourceDto(), { partnerId, sourceQualityRank: 'authorized_export', sbCompetitionId });
      expect((await validate(dto)).some(e => e.property === 'sbCompetitionId')).toBe(true);
    }
  });
  it('stores a legacy competition ID after checking the competition exists', async () => {
    prisma.sbMatch.findUnique.mockResolvedValue({ id: legacyId, competitionId: legacyCompetitionId });
    const row = await service.createSource({ partnerId, sourceQualityRank: 'authorized_export', sbMatchId: legacyId, sbCompetitionId: legacyCompetitionId });
    expect(prisma.sbCompetition.findUnique).toHaveBeenCalledWith({ where: { id: legacyCompetitionId }, select: { id: true } });
    expect(row.sbCompetitionId).toBe(legacyCompetitionId);
  });
  it('refuses an unknown competition before storing a source or audit row', async () => {
    prisma.sbCompetition.findUnique.mockResolvedValue(null);
    await expect(service.createSource({ partnerId, sourceQualityRank: 'authorized_export', sbCompetitionId: legacyCompetitionId })).rejects.toMatchObject({ status: 404 });
    expect(prisma.visionSourceVideoRecord.create).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });
  it('keeps cataloguing unlinked footage without a match lookup', async () => {
    await service.createSource({ partnerId, sourceQualityRank: 'authorized_export' });
    expect(prisma.sbMatch.findUnique).not.toHaveBeenCalled();
    expect(prisma.sbCompetition.findUnique).not.toHaveBeenCalled();
  });
});
