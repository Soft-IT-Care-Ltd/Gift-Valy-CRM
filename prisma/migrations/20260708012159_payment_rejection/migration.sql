-- AlterTable
ALTER TABLE "payments" ADD COLUMN     "is_rejected" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "rejected_by" INTEGER,
ADD COLUMN     "rejection_reason" TEXT;
