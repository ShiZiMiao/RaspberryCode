import type {
  RemoteSyncWriteAccessResult,
  SkillDataSyncPayload,
  SkillSyncArchiveExportResult,
  SkillSyncCandidateListResult,
  SkillSyncImportResult,
  SkillSyncRemoteStatusResult,
} from "@raspberrycode/shared";
import { ServiceChannels } from "@raspberrycode/shared";
import { createServiceDescriptor } from "../descriptors.js";
import type { IDataSyncCategoryService } from "../data-sync/contract.js";

/**
 * 技能同步服务：数据同步弹窗使用 IDataSyncCategoryService 的统一形状；
 * 远端弹窗另外使用候选/状态/归档这组方法。
 */
export interface ISkillSyncService extends IDataSyncCategoryService<SkillDataSyncPayload> {
  listLocalUserSkillCandidates(): Promise<SkillSyncCandidateListResult>;
  listRemoteUserSkillStatuses(params: {
    directoryNames: string[];
    skills?: Array<{
      directoryName: string;
      name: string;
    }>;
  }): Promise<SkillSyncRemoteStatusResult>;
  exportSkillsArchive(params: { skillIds: string[] }): Promise<SkillSyncArchiveExportResult>;
  checkRemoteUserSkillWriteAccess(): Promise<RemoteSyncWriteAccessResult>;
  importSkillsArchive(params: {
    archive: Uint8Array;
    overwrite?: false;
  }): Promise<SkillSyncImportResult>;
}

export const ISkillSyncService = createServiceDescriptor<ISkillSyncService>(
  ServiceChannels.SkillSync,
);
