-- CreateTable
CREATE TABLE "Protocol" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Protocol_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Venue" (
    "id" TEXT NOT NULL,
    "protocolId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "label" TEXT,
    "meta" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Venue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Snapshot" (
    "id" TEXT NOT NULL,
    "venueId" TEXT NOT NULL,
    "ts" TIMESTAMPTZ(6) NOT NULL,
    "tvl" DOUBLE PRECISION,
    "liquidity" DOUBLE PRECISION,
    "volume" DOUBLE PRECISION,
    "apy" DOUBLE PRECISION,
    "utilization" DOUBLE PRECISION,
    "inflow" DOUBLE PRECISION,
    "outflow" DOUBLE PRECISION,
    "netflow" DOUBLE PRECISION,
    "data" JSONB,

    CONSTRAINT "Snapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Protocol_key_key" ON "Protocol"("key");

-- CreateIndex
CREATE UNIQUE INDEX "Venue_key_key" ON "Venue"("key");

-- CreateIndex
CREATE INDEX "Snapshot_venueId_ts_idx" ON "Snapshot"("venueId", "ts");

-- AddForeignKey
ALTER TABLE "Venue" ADD CONSTRAINT "Venue_protocolId_fkey" FOREIGN KEY ("protocolId") REFERENCES "Protocol"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Snapshot" ADD CONSTRAINT "Snapshot_venueId_fkey" FOREIGN KEY ("venueId") REFERENCES "Venue"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
