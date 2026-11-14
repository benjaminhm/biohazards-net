-- Migration 078: a tip receipt is one trip. Its tip address, where that is,
-- and the driving distance site → tip → site (Google), or kilometres typed by
-- staff. The Contents Disposal Record's kilometres come from these.

alter table job_receipts
  add column if not exists tip_address text not null default '',
  add column if not exists tip_lat double precision,
  add column if not exists tip_lng double precision,
  add column if not exists distance_out_km numeric,
  add column if not exists distance_return_km numeric,
  add column if not exists distance_km numeric,
  add column if not exists distance_from_maps boolean not null default false;
