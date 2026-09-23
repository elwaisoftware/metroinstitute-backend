-- CreateEnum
CREATE TYPE "Role" AS ENUM ('MENTEE', 'SUPER_ADMIN');

-- CreateEnum
CREATE TYPE "Field" AS ENUM ('UI_UX', 'FRONTEND', 'BACKEND', 'MOBILE');

-- CreateEnum
CREATE TYPE "Level" AS ENUM ('BEGINNER', 'ELEMENTARY', 'INTERMEDIATE', 'ADVANCED');

-- CreateEnum
CREATE TYPE "BadgeLevel" AS ENUM ('METRO_ROOKIE', 'METRO_EXPLORER', 'METRO_ACHIEVER', 'METRO_EXPERT', 'METRO_MASTER');

-- CreateEnum
CREATE TYPE "XpSource" AS ENUM ('SKILL_TEST_COMPLETE', 'PROFILE_PHOTO_UPLOAD', 'VIDEO_COMPLETE', 'LIVE_ATTEND', 'CHALLENGE_QUIZ_CORRECT', 'ASSIGNMENT_ON_TIME', 'ASSIGNMENT_GRADED', 'STREAK_7', 'STREAK_30', 'STREAK_100', 'MANUAL_GRANT');

-- CreateEnum
CREATE TYPE "SessionType" AS ENUM ('VIDEO', 'LIVE', 'ASSIGNMENT', 'QUIZ');

-- CreateEnum
CREATE TYPE "NotifType" AS ENUM ('COURSE_ACCESS_EXPIRING', 'BOOTCAMP_ENDING', 'LIVE_REMINDER', 'ASSIGNMENT_GRADED', 'STREAK_MILESTONE', 'BADGE_UPGRADE', 'PURCHASE_SUCCESS', 'SYSTEM_BROADCAST');

-- CreateEnum
CREATE TYPE "TxStatus" AS ENUM ('PENDING', 'SUCCESS', 'FAILED', 'CANCELLED', 'REFUNDED');

-- CreateEnum
CREATE TYPE "ProductType" AS ENUM ('BOOTCAMP', 'MINI_COURSE');

-- CreateEnum
CREATE TYPE "CertType" AS ENUM ('BOOTCAMP', 'MINI_COURSE');

-- CreateEnum
CREATE TYPE "ChallengeType" AS ENUM ('QUIZ', 'PROJECT');

-- CreateEnum
CREATE TYPE "AttendanceStatus" AS ENUM ('PRESENT', 'ABSENT', 'MANUAL');

-- CreateEnum
CREATE TYPE "BatchStatus" AS ENUM ('OPEN', 'ONGOING', 'CLOSED', 'COMING_SOON');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "passwordHash" TEXT,
    "photoUrl" TEXT,
    "bio" TEXT,
    "status" TEXT,
    "institution" TEXT,
    "role" "Role" NOT NULL DEFAULT 'MENTEE',
    "isEmailVerified" BOOLEAN NOT NULL DEFAULT false,
    "isSuspended" BOOLEAN NOT NULL DEFAULT false,
    "googleId" TEXT,
    "selectedField" "Field",
    "skillTestDone" BOOLEAN NOT NULL DEFAULT false,
    "skillTestResult" JSONB,
    "currentLevel" "Level",
    "totalXp" INTEGER NOT NULL DEFAULT 0,
    "currentStreak" INTEGER NOT NULL DEFAULT 0,
    "longestStreak" INTEGER NOT NULL DEFAULT 0,
    "lastActivityAt" TIMESTAMP(3),
    "badgeLevel" "BadgeLevel" NOT NULL DEFAULT 'METRO_ROOKIE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_sessions" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "refreshToken" TEXT NOT NULL,
    "deviceInfo" TEXT,
    "ipAddress" TEXT,
    "isRevoked" BOOLEAN NOT NULL DEFAULT false,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "email_verify_tokens" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "email_verify_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "password_reset_tokens" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "password_reset_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "skill_test_questions" (
    "id" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "imageUrl" TEXT,
    "options" JSONB NOT NULL,
    "weights" JSONB NOT NULL,
    "orderIndex" INTEGER NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "skill_test_questions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bootcamps" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "shortDescription" TEXT NOT NULL DEFAULT '',
    "description" TEXT NOT NULL,
    "field" "Field" NOT NULL,
    "level" "Level" NOT NULL DEFAULT 'BEGINNER',
    "price" INTEGER NOT NULL,
    "thumbnailUrl" TEXT,
    "quota" INTEGER NOT NULL DEFAULT 50,
    "totalDuration" INTEGER NOT NULL DEFAULT 0,
    "tags" TEXT[],
    "outcomes" TEXT[],
    "batchStatus" "BatchStatus" NOT NULL DEFAULT 'COMING_SOON',
    "registrationDeadline" TIMESTAMP(3),
    "batchStartDate" TIMESTAMP(3),
    "batchEndDate" TIMESTAMP(3),
    "mentorName" TEXT,
    "mentorPhotoUrl" TEXT,
    "mentorBio" TEXT,
    "isPublished" BOOLEAN NOT NULL DEFAULT false,
    "isFeatured" BOOLEAN NOT NULL DEFAULT false,
    "rating" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "reviewCount" INTEGER NOT NULL DEFAULT 0,
    "enrollmentCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bootcamps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bootcamp_chapters" (
    "id" TEXT NOT NULL,
    "bootcampId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "orderIndex" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bootcamp_chapters_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bootcamp_sessions" (
    "id" TEXT NOT NULL,
    "chapterId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "type" "SessionType" NOT NULL,
    "videoUrl" TEXT,
    "videoDuration" INTEGER,
    "liveUrl" TEXT,
    "liveScheduledAt" TIMESTAMP(3),
    "attendanceWindowMin" INTEGER,
    "materials" JSONB,
    "assignmentDescription" TEXT,
    "assignmentDeadline" TIMESTAMP(3),
    "quizOptions" JSONB,
    "isFreePreview" BOOLEAN NOT NULL DEFAULT false,
    "orderIndex" INTEGER NOT NULL,
    "xpReward" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bootcamp_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bootcamp_enrollments" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "bootcampId" TEXT NOT NULL,
    "field" "Field" NOT NULL,
    "progress" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "removedAt" TIMESTAMP(3),
    "removedReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bootcamp_enrollments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "live_attendances" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" "AttendanceStatus" NOT NULL DEFAULT 'PRESENT',
    "attendedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "markedByAdmin" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "live_attendances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mini_courses" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "shortDescription" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "field" "Field" NOT NULL,
    "level" "Level" NOT NULL,
    "price" INTEGER NOT NULL,
    "thumbnailUrl" TEXT,
    "totalDuration" INTEGER NOT NULL DEFAULT 0,
    "accessDays" INTEGER NOT NULL DEFAULT 90,
    "isPublished" BOOLEAN NOT NULL DEFAULT false,
    "isFeatured" BOOLEAN NOT NULL DEFAULT false,
    "rating" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "reviewCount" INTEGER NOT NULL DEFAULT 0,
    "enrollmentCount" INTEGER NOT NULL DEFAULT 0,
    "tags" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "mini_courses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "course_chapters" (
    "id" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "orderIndex" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "course_chapters_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "course_sessions" (
    "id" TEXT NOT NULL,
    "chapterId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "type" "SessionType" NOT NULL,
    "videoUrl" TEXT,
    "videoDuration" INTEGER,
    "materials" JSONB,
    "assignmentDescription" TEXT,
    "assignmentDeadline" TIMESTAMP(3),
    "quizOptions" JSONB,
    "isFreePreview" BOOLEAN NOT NULL DEFAULT false,
    "orderIndex" INTEGER NOT NULL,
    "xpReward" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "course_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "course_enrollments" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "accessUntil" TIMESTAMP(3) NOT NULL,
    "progress" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "course_enrollments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "session_progress" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "bootcampSessionId" TEXT,
    "courseSessionId" TEXT,
    "watchedSeconds" INTEGER NOT NULL DEFAULT 0,
    "isCompleted" BOOLEAN NOT NULL DEFAULT false,
    "completedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "session_progress_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notes" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "bootcampSessionId" TEXT,
    "courseSessionId" TEXT,
    "content" TEXT NOT NULL,
    "timestampSec" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "notes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "qna_messages" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "bootcampSessionId" TEXT,
    "courseSessionId" TEXT,
    "content" TEXT NOT NULL,
    "parentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "qna_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assignments" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "bootcampSessionId" TEXT,
    "courseSessionId" TEXT,
    "fileUrl" TEXT,
    "linkUrl" TEXT,
    "description" TEXT,
    "score" INTEGER,
    "feedback" TEXT,
    "xpAwarded" INTEGER,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "gradedAt" TIMESTAMP(3),

    CONSTRAINT "assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "challenges" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "type" "ChallengeType" NOT NULL,
    "field" "Field" NOT NULL,
    "level" "Level" NOT NULL,
    "timeLimitSec" INTEGER,
    "xpReward" INTEGER NOT NULL,
    "options" JSONB,
    "tags" TEXT[],
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "challenges_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "challenge_attempts" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "challengeId" TEXT NOT NULL,
    "isCorrect" BOOLEAN,
    "answer" TEXT,
    "fileUrl" TEXT,
    "linkUrl" TEXT,
    "xpAwarded" INTEGER,
    "canRetryAt" TIMESTAMP(3),
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "gradedAt" TIMESTAMP(3),

    CONSTRAINT "challenge_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "xp_logs" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "source" "XpSource" NOT NULL,
    "amount" INTEGER NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "xp_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "xp_configs" (
    "id" TEXT NOT NULL,
    "source" "XpSource" NOT NULL,
    "amount" INTEGER NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "xp_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "badge_configs" (
    "id" TEXT NOT NULL,
    "level" "BadgeLevel" NOT NULL,
    "minXp" INTEGER NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "badge_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "leaderboard_snapshots" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "totalXp" INTEGER NOT NULL,
    "rank" INTEGER NOT NULL,
    "period" TEXT NOT NULL,
    "field" "Field",
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "leaderboard_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "NotifType" NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "isRead" BOOLEAN NOT NULL DEFAULT false,
    "data" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_preferences" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "emailEnabled" JSONB NOT NULL DEFAULT '{}',
    "inAppEnabled" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "notification_preferences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "certificates" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "productType" "CertType" NOT NULL,
    "bootcampId" TEXT,
    "courseId" TEXT,
    "credentialId" TEXT NOT NULL,
    "pdfUrl" TEXT,
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "certificates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "certificate_configs" (
    "id" TEXT NOT NULL,
    "productType" "CertType" NOT NULL,
    "minProgressPct" DOUBLE PRECISION NOT NULL DEFAULT 100,
    "minAssignScore" INTEGER NOT NULL DEFAULT 70,
    "minAttendancePct" DOUBLE PRECISION,
    "minXp" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "certificate_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transactions" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "productType" "ProductType" NOT NULL,
    "bootcampId" TEXT,
    "courseId" TEXT,
    "title" TEXT NOT NULL DEFAULT '',
    "voucherId" TEXT,
    "amount" INTEGER NOT NULL,
    "discountAmount" INTEGER NOT NULL DEFAULT 0,
    "status" "TxStatus" NOT NULL DEFAULT 'PENDING',
    "snapToken" TEXT,
    "paidAt" TIMESTAMP(3),
    "refundedAt" TIMESTAMP(3),
    "refundReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vouchers" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "value" INTEGER NOT NULL,
    "maxUsage" INTEGER NOT NULL,
    "maxPerUser" INTEGER NOT NULL DEFAULT 1,
    "usageCount" INTEGER NOT NULL DEFAULT 0,
    "validFrom" TIMESTAMP(3) NOT NULL,
    "validUntil" TIMESTAMP(3) NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vouchers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reviews" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "productType" "ProductType" NOT NULL,
    "bootcampId" TEXT,
    "courseId" TEXT,
    "rating" INTEGER NOT NULL,
    "content" TEXT,
    "isHidden" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "reviews_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "session_ratings" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "bootcampSessionId" TEXT,
    "courseSessionId" TEXT,
    "qualityRating" INTEGER NOT NULL,
    "clarityRating" INTEGER NOT NULL,
    "relevanceRating" INTEGER NOT NULL,
    "comment" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "session_ratings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wishlist_items" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "productType" "ProductType" NOT NULL,
    "bootcampId" TEXT,
    "courseId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "wishlist_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "leads" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "source" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "leads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "homepage_configs" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "homepage_configs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "users_phone_key" ON "users"("phone");

-- CreateIndex
CREATE UNIQUE INDEX "users_googleId_key" ON "users"("googleId");

-- CreateIndex
CREATE UNIQUE INDEX "user_sessions_refreshToken_key" ON "user_sessions"("refreshToken");

-- CreateIndex
CREATE UNIQUE INDEX "email_verify_tokens_token_key" ON "email_verify_tokens"("token");

-- CreateIndex
CREATE UNIQUE INDEX "password_reset_tokens_token_key" ON "password_reset_tokens"("token");

-- CreateIndex
CREATE UNIQUE INDEX "bootcamp_enrollments_userId_bootcampId_key" ON "bootcamp_enrollments"("userId", "bootcampId");

-- CreateIndex
CREATE UNIQUE INDEX "live_attendances_sessionId_userId_key" ON "live_attendances"("sessionId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "course_enrollments_userId_courseId_key" ON "course_enrollments"("userId", "courseId");

-- CreateIndex
CREATE UNIQUE INDEX "session_progress_userId_bootcampSessionId_key" ON "session_progress"("userId", "bootcampSessionId");

-- CreateIndex
CREATE UNIQUE INDEX "session_progress_userId_courseSessionId_key" ON "session_progress"("userId", "courseSessionId");

-- CreateIndex
CREATE UNIQUE INDEX "xp_configs_source_key" ON "xp_configs"("source");

-- CreateIndex
CREATE UNIQUE INDEX "badge_configs_level_key" ON "badge_configs"("level");

-- CreateIndex
CREATE UNIQUE INDEX "notification_preferences_userId_key" ON "notification_preferences"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "certificates_credentialId_key" ON "certificates"("credentialId");

-- CreateIndex
CREATE UNIQUE INDEX "certificate_configs_productType_key" ON "certificate_configs"("productType");

-- CreateIndex
CREATE UNIQUE INDEX "transactions_orderId_key" ON "transactions"("orderId");

-- CreateIndex
CREATE UNIQUE INDEX "vouchers_code_key" ON "vouchers"("code");

-- CreateIndex
CREATE UNIQUE INDEX "reviews_userId_bootcampId_key" ON "reviews"("userId", "bootcampId");

-- CreateIndex
CREATE UNIQUE INDEX "reviews_userId_courseId_key" ON "reviews"("userId", "courseId");

-- CreateIndex
CREATE UNIQUE INDEX "session_ratings_userId_bootcampSessionId_key" ON "session_ratings"("userId", "bootcampSessionId");

-- CreateIndex
CREATE UNIQUE INDEX "session_ratings_userId_courseSessionId_key" ON "session_ratings"("userId", "courseSessionId");

-- CreateIndex
CREATE UNIQUE INDEX "leads_email_key" ON "leads"("email");

-- CreateIndex
CREATE UNIQUE INDEX "homepage_configs_key_key" ON "homepage_configs"("key");

-- AddForeignKey
ALTER TABLE "user_sessions" ADD CONSTRAINT "user_sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_verify_tokens" ADD CONSTRAINT "email_verify_tokens_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "password_reset_tokens" ADD CONSTRAINT "password_reset_tokens_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bootcamp_chapters" ADD CONSTRAINT "bootcamp_chapters_bootcampId_fkey" FOREIGN KEY ("bootcampId") REFERENCES "bootcamps"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bootcamp_sessions" ADD CONSTRAINT "bootcamp_sessions_chapterId_fkey" FOREIGN KEY ("chapterId") REFERENCES "bootcamp_chapters"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bootcamp_enrollments" ADD CONSTRAINT "bootcamp_enrollments_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bootcamp_enrollments" ADD CONSTRAINT "bootcamp_enrollments_bootcampId_fkey" FOREIGN KEY ("bootcampId") REFERENCES "bootcamps"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "live_attendances" ADD CONSTRAINT "live_attendances_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "bootcamp_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "course_chapters" ADD CONSTRAINT "course_chapters_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "mini_courses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "course_sessions" ADD CONSTRAINT "course_sessions_chapterId_fkey" FOREIGN KEY ("chapterId") REFERENCES "course_chapters"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "course_enrollments" ADD CONSTRAINT "course_enrollments_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "course_enrollments" ADD CONSTRAINT "course_enrollments_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "mini_courses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "session_progress" ADD CONSTRAINT "session_progress_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "session_progress" ADD CONSTRAINT "session_progress_bootcampSessionId_fkey" FOREIGN KEY ("bootcampSessionId") REFERENCES "bootcamp_sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "session_progress" ADD CONSTRAINT "session_progress_courseSessionId_fkey" FOREIGN KEY ("courseSessionId") REFERENCES "course_sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notes" ADD CONSTRAINT "notes_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "qna_messages" ADD CONSTRAINT "qna_messages_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "qna_messages" ADD CONSTRAINT "qna_messages_bootcampSessionId_fkey" FOREIGN KEY ("bootcampSessionId") REFERENCES "bootcamp_sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "qna_messages" ADD CONSTRAINT "qna_messages_courseSessionId_fkey" FOREIGN KEY ("courseSessionId") REFERENCES "course_sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_bootcampSessionId_fkey" FOREIGN KEY ("bootcampSessionId") REFERENCES "bootcamp_sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_courseSessionId_fkey" FOREIGN KEY ("courseSessionId") REFERENCES "course_sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "challenge_attempts" ADD CONSTRAINT "challenge_attempts_challengeId_fkey" FOREIGN KEY ("challengeId") REFERENCES "challenges"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "xp_logs" ADD CONSTRAINT "xp_logs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leaderboard_snapshots" ADD CONSTRAINT "leaderboard_snapshots_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "certificates" ADD CONSTRAINT "certificates_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_bootcampId_fkey" FOREIGN KEY ("bootcampId") REFERENCES "bootcamps"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "mini_courses"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_voucherId_fkey" FOREIGN KEY ("voucherId") REFERENCES "vouchers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_bootcampId_fkey" FOREIGN KEY ("bootcampId") REFERENCES "bootcamps"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "mini_courses"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "session_ratings" ADD CONSTRAINT "session_ratings_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "session_ratings" ADD CONSTRAINT "session_ratings_bootcampSessionId_fkey" FOREIGN KEY ("bootcampSessionId") REFERENCES "bootcamp_sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "session_ratings" ADD CONSTRAINT "session_ratings_courseSessionId_fkey" FOREIGN KEY ("courseSessionId") REFERENCES "course_sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wishlist_items" ADD CONSTRAINT "wishlist_items_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wishlist_items" ADD CONSTRAINT "wishlist_items_bootcampId_fkey" FOREIGN KEY ("bootcampId") REFERENCES "bootcamps"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wishlist_items" ADD CONSTRAINT "wishlist_items_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "mini_courses"("id") ON DELETE SET NULL ON UPDATE CASCADE;
