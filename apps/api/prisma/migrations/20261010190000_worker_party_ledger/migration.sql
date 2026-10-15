-- Party ledger kinds: salary jama (credit) + other debit (khana bill, etc.)
ALTER TYPE "WorkerLedgerKind" ADD VALUE IF NOT EXISTS 'SALARY_CREDIT';
ALTER TYPE "WorkerLedgerKind" ADD VALUE IF NOT EXISTS 'OTHER_DEBIT';
