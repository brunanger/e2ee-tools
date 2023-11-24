import * as openpgp from "openpgp";
import { tryCatch } from "./error";
import { arrayToHexString } from "./encoding.utils";

openpgp.config.preferredSymmetricAlgorithm = 9; // set default to aes256

export class PGPPrivateKey extends openpgp.PrivateKey {}
export class PGPPublicKey extends openpgp.PublicKey {}

export class PGPService {
  generateKeyPair = tryCatch(
    "pgp.generateKeyPair",
    async (passphrase: string, userId: string) =>
      await openpgp.generateKey({
        type: "ecc", // Type of the key, defaults to ECC
        curve: "curve25519", // ECC curve name, defaults to curve25519
        userIDs: [{ name: userId }], // you can pass multiple user IDs
        passphrase, // protects the private key
        format: "armored", // output key format, defaults to 'armored' (other options: 'binary' or 'object')
      })
  );

  generateEncryptionKey = tryCatch(
    "pgp.generateEncryptionKey",
    async (publicKey: PGPPublicKey): Promise<string> =>
      arrayToHexString(
        (
          await openpgp.generateSessionKey({
            encryptionKeys: publicKey,
          })
        ).data
      )
  );

  readPublicKey = tryCatch(
    "pgp.readPublicKey",
    async (publicKeyArmored: string) =>
      (await openpgp.readKey({ armoredKey: publicKeyArmored })) as PGPPublicKey
  );

  readPrivateKey = tryCatch(
    "pgp.readPrivateKey",
    async (privateKeyArmored: string) =>
      (await openpgp.readPrivateKey({
        armoredKey: privateKeyArmored,
      })) as PGPPrivateKey
  );

  decryptPrivateKey = tryCatch(
    "pgp.decryptPrivateKey",
    async (privateKeyArmored: string, passphrase: string) => {
      const privateKey = await this.readPrivateKey(privateKeyArmored);
      return (await openpgp.decryptKey({
        privateKey,
        passphrase,
      })) as PGPPrivateKey;
    }
  );

  encryptAsymmetric = tryCatch(
    "pgp.encryptAsymmetric",
    async (
      privateKey: PGPPrivateKey,
      encryptionKeys: PGPPublicKey[],
      data: string
    ): Promise<string> => {
      const message = await openpgp.createMessage({ text: data });
      const encrypted = await openpgp.encrypt({
        message,
        encryptionKeys,
        signingKeys: privateKey,
      });
      return encrypted as string;
    }
  );

  decryptAsymmetric = tryCatch(
    "pgp.decryptAsymmetric",
    async (
      privateKey: PGPPrivateKey,
      verificationKeys: PGPPublicKey[],
      data: string
    ): Promise<string> => {
      const message = await openpgp.readMessage({ armoredMessage: data });
      const decrypted = await openpgp.decrypt({
        message,
        verificationKeys: verificationKeys,
        decryptionKeys: privateKey,
        expectSigned: true,
      });
      return decrypted.data as string;
    }
  );

  encrypt = tryCatch(
    "pgp.encrypt",
    async (key: string, data: string): Promise<string> => {
      const message = await openpgp.createMessage({ text: data });
      const encrypted = await openpgp.encrypt({
        message,
        passwords: key,
      });
      return encrypted as string;
    }
  );

  decrypt = tryCatch(
    "pgp.decrypt",
    async (key: string, data: string): Promise<string> => {
      const message = await openpgp.readMessage({ armoredMessage: data });
      const decrypted = await openpgp.decrypt({ message, passwords: key });
      return decrypted.data as string;
    }
  );
}
