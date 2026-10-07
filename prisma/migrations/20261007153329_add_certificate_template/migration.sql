-- CreateEnum
DO $$ BEGIN
    CREATE TYPE "CertType" AS ENUM ('BOOTCAMP', 'MINI_COURSE');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- CreateTable: certificate_templates
CREATE TABLE IF NOT EXISTS "certificate_templates" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "CertType" NOT NULL,
    "bgImage" TEXT NOT NULL,
    "config" JSONB NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "certificate_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable: certificate_configs
CREATE TABLE IF NOT EXISTS "certificate_configs" (
    "id" TEXT NOT NULL,
    "productType" "CertType" NOT NULL,
    "minProgressPct" DOUBLE PRECISION NOT NULL DEFAULT 100,
    "minAssignScore" INTEGER NOT NULL DEFAULT 70,
    "minAttendancePct" DOUBLE PRECISION,
    "minXp" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "certificate_configs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "certificate_configs_productType_key" ON "certificate_configs"("productType");

-- AddColumn: certificateTemplateId to bootcamps
ALTER TABLE "bootcamps" ADD COLUMN IF NOT EXISTS "certificateTemplateId" TEXT;

-- AddColumn: certificateTemplateId to mini_courses
ALTER TABLE "mini_courses" ADD COLUMN IF NOT EXISTS "certificateTemplateId" TEXT;

-- AddForeignKey: bootcamps -> certificate_templates
DO $$ BEGIN
    ALTER TABLE "bootcamps" ADD CONSTRAINT "bootcamps_certificateTemplateId_fkey"
        FOREIGN KEY ("certificateTemplateId") REFERENCES "certificate_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- AddForeignKey: mini_courses -> certificate_templates
DO $$ BEGIN
    ALTER TABLE "mini_courses" ADD CONSTRAINT "mini_courses_certificateTemplateId_fkey"
        FOREIGN KEY ("certificateTemplateId") REFERENCES "certificate_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;
