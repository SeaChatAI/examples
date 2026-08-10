#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
REPO_DIR="$(cd "${PROJECT_DIR}/../.." && pwd)"
SECRET_FILE="${SEACHAT_PROD_EMAIL_LOGIN_ENV:-${REPO_DIR}/services/sea-mono/.secrets/seachat-prod-email-login.env}"

if [[ ! -f "${SECRET_FILE}" ]]; then
  echo "missing production email-login env: ${SECRET_FILE}" >&2
  exit 66
fi

set -a
# shellcheck disable=SC1090
source "${SECRET_FILE}"
set +a

exec bun run "${SCRIPT_DIR}/accept-cloud-live.ts"
