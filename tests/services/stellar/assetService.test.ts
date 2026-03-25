import * as StellarSdk from "stellar-sdk";
import {
  AssetService,
  buildAsset,
  getConfiguredPaymentAsset,
  validateAssetCode,
} from "../../../src/services/stellar/assetService";

describe("assetService", () => {
  describe("validateAssetCode", () => {
    it("accepts 4-char alphanumeric codes", () => {
      expect(() => validateAssetCode("USDC")).not.toThrow();
    });

    it("rejects empty or invalid", () => {
      expect(() => validateAssetCode("")).toThrow();
      expect(() => validateAssetCode("BAD_CODE!")).toThrow();
    });
  });

  describe("buildAsset", () => {
    it("builds non-native asset", () => {
      const issuer = StellarSdk.Keypair.random().publicKey();
      const a = buildAsset("USDC", issuer);
      expect(a.getCode()).toBe("USDC");
      expect(a.getIssuer()).toBe(issuer);
    });
  });

  describe("getConfiguredPaymentAsset", () => {
    const oldCode = process.env.STELLAR_ASSET_CODE;
    const oldIssuer = process.env.STELLAR_ASSET_ISSUER;

    afterEach(() => {
      process.env.STELLAR_ASSET_CODE = oldCode;
      process.env.STELLAR_ASSET_ISSUER = oldIssuer;
    });

    it("returns native when code unset", () => {
      delete process.env.STELLAR_ASSET_CODE;
      delete process.env.STELLAR_ASSET_ISSUER;
      const a = getConfiguredPaymentAsset();
      expect(a.isNative()).toBe(true);
    });
  });

  describe("AssetService.hasTrustline", () => {
    it("returns true for native asset without hitting server", async () => {
      const svc = new AssetService();
      await expect(
        svc.hasTrustline("GANY", StellarSdk.Asset.native()),
      ).resolves.toBe(true);
    });
  });
});
