-- Kitchen SERVED (bumped) vs billing COMPLETED.
ALTER TYPE "OrderStatus" ADD VALUE IF NOT EXISTS 'SERVED';
