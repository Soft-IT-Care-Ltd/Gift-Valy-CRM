-- CreateEnum
CREATE TYPE "WalletType" AS ENUM ('BKASH', 'NAGAD', 'ROCKET', 'BANK', 'CASH');

-- CreateTable
CREATE TABLE "wallets" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "type" "WalletType" NOT NULL,
    "account_no" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by" INTEGER,
    "updated_by" INTEGER,

    CONSTRAINT "wallets_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "wallets_name_key" ON "wallets"("name");

-- CreateIndex
CREATE INDEX "expenses_wallet_id_idx" ON "expenses"("wallet_id");

-- CreateIndex
CREATE INDEX "payments_wallet_id_idx" ON "payments"("wallet_id");

-- CreateIndex
CREATE INDEX "payments_payment_date_idx" ON "payments"("payment_date");

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_wallet_id_fkey" FOREIGN KEY ("wallet_id") REFERENCES "wallets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_wallet_id_fkey" FOREIGN KEY ("wallet_id") REFERENCES "wallets"("id") ON DELETE SET NULL ON UPDATE CASCADE;
