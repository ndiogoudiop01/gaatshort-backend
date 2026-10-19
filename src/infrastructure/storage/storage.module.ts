import { Global, Module } from '@nestjs/common';
import { STORAGE } from '@shared/kernel/ports/storage.port';
import { S3StorageAdapter } from './adapters/s3-storage.adapter';
import { StorageKeyFactory } from './storage-key.factory';

@Global()
@Module({
  providers: [S3StorageAdapter, { provide: STORAGE, useExisting: S3StorageAdapter }, StorageKeyFactory],
  exports: [STORAGE, StorageKeyFactory],
})
export class StorageModule {}
