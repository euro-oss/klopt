#!/usr/bin/env bash
# Create the two Scaleway buckets. Run on a laptop with AWS CLI v2 and
# credentials that can create buckets in nl-ams. Placeholders only — no keys
# in this file.
#
#   export AWS_ACCESS_KEY_ID=…
#   export AWS_SECRET_ACCESS_KEY=…
#   export AWS_ENDPOINT_URL=https://s3.nl-ams.scw.cloud
#   ./scripts/create-buckets.sh
set -euo pipefail

ENDPOINT="${AWS_ENDPOINT_URL:-https://s3.nl-ams.scw.cloud}"
REGION="${BACKUP_S3_REGION:-nl-ams}"
DOCUMENTS="${KLOPT_S3_DOCUMENTS_BUCKET:-klopt-hidde-documents}"
BACKUPS="${BACKUPS_BUCKET:-klopt-hidde-backups}"

aws_scw() {
  aws --endpoint-url "$ENDPOINT" --region "$REGION" "$@"
}

echo "creating ${DOCUMENTS} (object lock on, no default retention)"
aws_scw s3api create-bucket \
  --bucket "$DOCUMENTS" \
  --object-lock-enabled-for-bucket \
  --create-bucket-configuration LocationConstraint="$REGION"

aws_scw s3api put-object-lock-configuration \
  --bucket "$DOCUMENTS" \
  --object-lock-configuration '{"ObjectLockEnabled":"Enabled"}'

echo "creating ${BACKUPS} (object lock governance, 30-day default)"
aws_scw s3api create-bucket \
  --bucket "$BACKUPS" \
  --object-lock-enabled-for-bucket \
  --create-bucket-configuration LocationConstraint="$REGION"

aws_scw s3api put-object-lock-configuration \
  --bucket "$BACKUPS" \
  --object-lock-configuration '{"ObjectLockEnabled":"Enabled","Rule":{"DefaultRetention":{"Mode":"GOVERNANCE","Days":30}}}'

echo "done. Enable versioning is implied by object lock on Scaleway."
