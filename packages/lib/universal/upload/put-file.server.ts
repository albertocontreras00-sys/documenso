import { PDFDocument } from '@cantoo/pdf-lib';
import { DocumentDataType } from '@prisma/client';
import { base64 } from '@scure/base';
import { match } from 'ts-pattern';

import { env } from '@documenso/lib/utils/env';

import { AppError } from '../../errors/app-error';
import { createDocumentData } from '../../server-only/document-data/create-document-data';
import { normalizePdf } from '../../server-only/pdf/normalize-pdf';
import { logEsignEvent, extractTraceId } from '../../server-only/esign-telemetry/esign-telemetry';
import { logDebug, logInfo } from '../../utils/logger';
import { uploadS3File } from './server-actions';

type File = {
  name: string;
  type: string;
  arrayBuffer: () => Promise<ArrayBuffer>;
};

/**
 * Uploads a document file to the appropriate storage location and creates
 * a document data record.
 */
export const putPdfFileServerSide = async (file: File) => {
  logDebug('PutPdfFile', 'Starting PDF file upload', {
    fileName: file.name,
    fileType: file.type,
  });

  const isEncryptedDocumentsAllowed = false; // Was feature flag.

  const arrayBuffer = await file.arrayBuffer();

  const pdf = await PDFDocument.load(arrayBuffer).catch((e) => {
    console.error(`PDF upload parse error: ${e.message}`);

    throw new AppError('INVALID_DOCUMENT_FILE');
  });

  if (!isEncryptedDocumentsAllowed && pdf.isEncrypted) {
    throw new AppError('INVALID_DOCUMENT_FILE');
  }

  if (!file.name.endsWith('.pdf')) {
    file.name = `${file.name}.pdf`;
  }

  const { type, data } = await putFileServerSide(file);

  const documentData = await createDocumentData({ type, data });

  logDebug('PutPdfFile', 'PDF file uploaded and document data created', {
    documentDataId: documentData.id,
    dataType: type,
  });

  return documentData;
};

/**
 * Uploads a pdf file and normalizes it.
 */
export const putNormalizedPdfFileServerSide = async (file: File) => {
  const buffer = Buffer.from(await file.arrayBuffer());

  const normalized = await normalizePdf(buffer);

  const fileName = file.name.endsWith('.pdf') ? file.name : `${file.name}.pdf`;

  const documentData = await putFileServerSide({
    name: fileName,
    type: 'application/pdf',
    arrayBuffer: async () => Promise.resolve(normalized),
  });

  return await createDocumentData({
    type: documentData.type,
    data: documentData.data,
  });
};

/**
 * Uploads a file to the appropriate storage location.
 */
export const putFileServerSide = async (file: File) => {
  const NEXT_PUBLIC_UPLOAD_TRANSPORT = env('NEXT_PUBLIC_UPLOAD_TRANSPORT');

  return await match(NEXT_PUBLIC_UPLOAD_TRANSPORT)
    .with('s3', async () => putFileInS3(file))
    .otherwise(async () => putFileInDatabase(file));
};

const putFileInDatabase = async (file: File) => {
  const contents = await file.arrayBuffer();

  const binaryData = new Uint8Array(contents);

  const asciiData = base64.encode(binaryData);

  return {
    type: DocumentDataType.BYTES_64,
    data: asciiData,
  };
};

const putFileInS3 = async (file: File) => {
  logDebug('PutFileS3', 'Uploading file to S3', {
    fileName: file.name,
    fileSize: file.size || 'unknown',
  });

  const buffer = await file.arrayBuffer();

  const blob = new Blob([buffer], { type: file.type });

  const newFile = new File([blob], file.name, {
    type: file.type,
  });

  const { key } = await uploadS3File(newFile);

  logInfo('PutFileS3', 'File uploaded to S3 successfully', {
    fileName: file.name,
    s3Key: key,
    fileSize: buffer.byteLength,
  });

  // E-sign telemetry: S3 upload complete
  // Note: traceId may not be available at this level, so we generate a fallback
  // The traceId should ideally be passed from the caller, but for now we log with a generated one
  const traceId = extractTraceId({});
  await logEsignEvent({
    traceId,
    step: 'sign_s3_upload_complete',
    status: 'ok',
    extra: {
      fileName: file.name,
      fileSize: buffer.byteLength,
      s3Key: key,
    },
  });

  return {
    type: DocumentDataType.S3_PATH,
    data: key,
  };
};
