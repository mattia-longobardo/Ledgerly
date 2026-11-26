-- Times of the movements (decisions of Mattia 11 = A, 12 = A): whether `occurred_at` carries a real time of
-- day. Additive only. Every row of today is `false`: a bank's movement stands at noon and a manual one too,
-- and nothing tells them from a real 12:00. A provider that gives the time writes `true` at its next reading
-- of the movement. Way back: the image before, which does not read the column.
ALTER TABLE "transactions" ADD COLUMN "time_known" boolean DEFAULT false NOT NULL;
