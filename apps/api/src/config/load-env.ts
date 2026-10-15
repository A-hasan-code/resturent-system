import { loadEnvFile } from "./env";

loadEnvFile();

/**
 * Windows services often run as LocalSystem with UTC while the restaurant is local
 * (e.g. Asia/Karachi). Without TZ, businessWindow() builds the wrong day → empty
 * dashboard / billing on installed servers. hotel.env TZ wins when set; production
 * default matches this product's primary install region.
 */
if (!process.env.TZ && process.env.NODE_ENV === "production") {
  process.env.TZ = "Asia/Karachi";
}
