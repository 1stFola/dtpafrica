-- AlterTable
ALTER TABLE "academies" ADD COLUMN "login_username" TEXT;
ALTER TABLE "academies" ADD COLUMN "password_hash" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "academies_login_username_key" ON "academies"("login_username");
