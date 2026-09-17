export { createFilesystemDocumentStore, type FilesystemDocumentStoreOptions } from './filesystem.js'
export { S3StoreError, createS3DocumentStore, type S3DocumentStoreOptions } from './s3.js'
export { signS3Request, type S3Credentials, type SignedRequest } from './sigv4.js'
export {
  DocumentStoreConfigError,
  resolveDocumentStore,
  type DocumentStoreEnvironment,
} from './resolve.js'
