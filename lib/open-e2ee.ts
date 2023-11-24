import {
  MessageItemEncrypted,
  MessageItem,
  writeEncryptedMessage,
  readEncryptedMessage,
  ShareItemOut,
  ShareNewItemOut,
  ReceiveItemOut,
} from "./models";
import { PGPPrivateKey, PGPPublicKey, PGPService } from "./pgp";

export class OpenE2EE {
  private pgpService: PGPService;

  private passphrase: string;
  private privateKey?: PGPPrivateKey;
  private privateKeyEncryptedText: string = "";
  private publicKey?: PGPPublicKey;
  private publicKeyText: string = "";
  private userId: string;

  /**
   * @param userId user id in your platform
   * @param passphrase master password to encrypt PGP private key
   */
  constructor(userId: string, passphrase: string) {
    this.pgpService = new PGPService();
    this.userId = userId;
    this.passphrase = passphrase;
  }

  /**
   * Loads data with a new PGP pair.
   * @example const e2eeSvc = await new E2EEService().build(passphrase);
   */
  build = async (): Promise<OpenE2EE> => {
    const { privateKey, publicKey } = await this.pgpService.generateKeyPair(
      this.passphrase,
      this.userId
    );
    const keysObj = await Promise.all([
      this.pgpService.decryptPrivateKey(privateKey, this.passphrase),
      this.pgpService.readPublicKey(publicKey),
    ]);
    this.privateKey = keysObj[0];
    this.publicKey = keysObj[1];
    this.privateKeyEncryptedText = privateKey;
    this.publicKeyText = publicKey;
    return this;
  };

  /**
   * Loads data with an existant PGP key pair.
   * @example const e2eeSvc = await new E2EEService().load(passphrase, privateKey, publicKey);
   * @param encryptedPrivateKey encrypted PGP private key
   * @param publicKey PGP public key
   * */
  load = async (
    encryptedPrivateKey: string,
    publicKey: string
  ): Promise<OpenE2EE> => {
    const [privateKeyObj, publicKeyObj] = await Promise.all([
      this.pgpService.decryptPrivateKey(encryptedPrivateKey, this.passphrase),
      this.pgpService.readPublicKey(publicKey),
    ]);
    this.privateKey = privateKeyObj;
    this.publicKey = publicKeyObj;
    this.privateKeyEncryptedText = encryptedPrivateKey;
    this.publicKeyText = publicKey;
    return this;
  };

  /**
   * Exports master key encrypted with a derived key from passphrase to save it in database.
   * @returns privateKey: encrypted PGP private key, publicKey: PGP public key
   */
  exportMasterKeys = async () => {
    return {
      privateKey: this.privateKeyEncryptedText,
      publicKey: this.publicKeyText,
    };
  };

  /**
   * Encrypts an item with a new key, and encrypts it with PGP.
   * @param data value to encrypt
   * @returns encrypted message with key and data.
   */
  encrypt = async (data: string): Promise<MessageItemEncrypted> => {
    const key = await this.pgpService.generateEncryptionKey(
      this.publicKey as PGPPublicKey
    );
    const [encryptedKey, encryptedData] = await Promise.all([
      this.pgpService.encryptAsymmetric(
        this.privateKey as PGPPrivateKey,
        [this.publicKey as PGPPublicKey],
        key
      ),
      this.pgpService.encrypt(key, data),
    ]);
    return {
      key,
      encryptedMessage: writeEncryptedMessage(encryptedKey, encryptedData),
    };
  };

  /**
   * Decrypts the key using PGP and the item with the decrypted key.
   * @param encryptedMessage  encrypted message that contains both key and data
   * @returns both key and data decrypted
   */
  decrypt = async (
    encryptedMessage: string,
    externalEncryptionKeys: string[] = []
  ): Promise<MessageItem> => {
    const { encryptedKey, encryptedData } =
      readEncryptedMessage(encryptedMessage);
    const externalEncryptionKeysObj = await Promise.all(
      externalEncryptionKeys.map((e) => this.pgpService.readPublicKey(e))
    );
    const key = await this.pgpService.decryptAsymmetric(
      this.privateKey as PGPPrivateKey,
      [this.publicKey as PGPPublicKey, ...externalEncryptionKeysObj],
      encryptedKey
    );
    const data = await this.pgpService.decrypt(key, encryptedData);
    return { key, data };
  };

  /**
   * Share encrypted data with another user, encrypting messages with corresponding PGP public keys
   * @param receiverPublicKey receiver PGP public key
   * @param data data to encrypt and share
   * @returns senderPublicKey your publicKey to verify signature
   * and receiverEncryptedMessage with encrypted message with their PGP public key and signed
   */
  share = async (
    receiverPublicKey: string,
    encryptedMessage: string
  ): Promise<ShareItemOut> => {
    const { encryptedKey, encryptedData } =
      readEncryptedMessage(encryptedMessage);

    const receiverPublicKeyObj = await this.pgpService.readPublicKey(
      receiverPublicKey
    );

    const sharedKey = await this.pgpService.decryptAsymmetric(
      this.privateKey as PGPPrivateKey,
      [this.publicKey as PGPPublicKey],
      encryptedKey
    );

    const receiverEncryptedKey = await this.pgpService.encryptAsymmetric(
      this.privateKey as PGPPrivateKey,
      [this.publicKey as PGPPublicKey, receiverPublicKeyObj],
      sharedKey
    );

    return {
      senderPublicKey: this.publicKeyText,
      receiverEncryptedMessage: writeEncryptedMessage(
        receiverEncryptedKey,
        encryptedData
      ),
    };
  };

  /**
   * Share not encrypted data with another user, encrypting messages with corresponding PGP public keys
   * @param receiverPublicKey receiver PGP public key
   * @param data data to encrypt and share
   * @returns same as 'share()', and senderEncryptedMessage with the message encrypted with your PGP public key
   */
  shareNew = async (
    receiverPublicKey: string,
    data: string
  ): Promise<ShareNewItemOut> => {
    const receiverPublicKeyObj = await this.pgpService.readPublicKey(
      receiverPublicKey
    );
    const { key, encryptedMessage } = await this.encrypt(data);
    const receiverEncryptedKey = await this.pgpService.encryptAsymmetric(
      this.privateKey as PGPPrivateKey,
      [receiverPublicKeyObj],
      key
    );
    return {
      senderPublicKey: this.publicKeyText,
      senderEncryptedMessage: encryptedMessage,
      receiverEncryptedMessage: writeEncryptedMessage(
        receiverEncryptedKey,
        readEncryptedMessage(encryptedMessage).encryptedData
      ),
    };
  };

  /**
   * Receive an encrypted message with my PGP public key
   * @param senderPublicKey sender's PGP public key to validate signature
   * @param encryptedMessage
   * @returns decrypted key and data
   */
  receive = async (
    senderPublicKey: string,
    encryptedMessage: string
  ): Promise<ReceiveItemOut> =>
    await this.decrypt(encryptedMessage, [senderPublicKey]);
}
