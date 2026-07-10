-- CreateEnum
CREATE TYPE "TargetScope" AS ENUM ('USER', 'TEAM');

-- CreateEnum
CREATE TYPE "RewardRuleType" AS ENUM ('ACHIEVEMENT', 'TOP_SELLER');

-- CreateEnum
CREATE TYPE "RewardStatus" AS ENUM ('PENDING', 'APPROVED', 'PAID');

-- CreateTable
CREATE TABLE "targets" (
    "id" SERIAL NOT NULL,
    "month" DATE NOT NULL,
    "scope" "TargetScope" NOT NULL,
    "user_id" INTEGER,
    "team_id" INTEGER,
    "target_orders" INTEGER,
    "target_amount" DECIMAL(12,2),
    "is_confidential" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by" INTEGER,
    "updated_by" INTEGER,

    CONSTRAINT "targets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reward_rules" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "type" "RewardRuleType" NOT NULL DEFAULT 'ACHIEVEMENT',
    "min_achievement_percent" DECIMAL(6,2),
    "reward_amount" DECIMAL(12,2) NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by" INTEGER,
    "updated_by" INTEGER,

    CONSTRAINT "reward_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rewards" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "month" DATE NOT NULL,
    "rule_id" INTEGER NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "achievement_percent" DECIMAL(6,2),
    "status" "RewardStatus" NOT NULL DEFAULT 'PENDING',
    "approved_by" INTEGER,
    "approved_at" TIMESTAMP(3),
    "expense_id" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by" INTEGER,
    "updated_by" INTEGER,

    CONSTRAINT "rewards_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "targets_month_idx" ON "targets"("month");

-- CreateIndex
CREATE UNIQUE INDEX "targets_month_user_id_key" ON "targets"("month", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "targets_month_team_id_key" ON "targets"("month", "team_id");

-- CreateIndex
CREATE UNIQUE INDEX "reward_rules_name_key" ON "reward_rules"("name");

-- CreateIndex
CREATE UNIQUE INDEX "rewards_expense_id_key" ON "rewards"("expense_id");

-- CreateIndex
CREATE INDEX "rewards_month_idx" ON "rewards"("month");

-- CreateIndex
CREATE INDEX "rewards_user_id_idx" ON "rewards"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "rewards_user_id_month_rule_id_key" ON "rewards"("user_id", "month", "rule_id");

-- AddForeignKey
ALTER TABLE "targets" ADD CONSTRAINT "targets_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "targets" ADD CONSTRAINT "targets_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "teams"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rewards" ADD CONSTRAINT "rewards_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rewards" ADD CONSTRAINT "rewards_rule_id_fkey" FOREIGN KEY ("rule_id") REFERENCES "reward_rules"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

