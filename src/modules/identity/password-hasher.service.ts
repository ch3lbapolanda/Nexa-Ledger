import {
  Injectable,
  InternalServerErrorException,
} from '@nestjs/common';
import {
  randomBytes,
  scrypt,
  timingSafeEqual,
} from 'node:crypto';

@Injectable()
export class PasswordHasherService {
  private readonly cost = 32768;
  private readonly blockSize = 8;
  private readonly parallelization = 3;
  private readonly keyLength = 64;
  private readonly saltLength = 16;
  private readonly maxMemory = 64 * 1024 * 1024;

  private async deriveKey(
    password: string,
    salt: Buffer,
    cost: number,
    blockSize: number,
    parallelization: number,
  ): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      scrypt(
        password,
        salt,
        this.keyLength,
        {
          N: cost,
          r: blockSize,
          p: parallelization,
          maxmem: this.maxMemory,
        },
        (error, derivedKey) => {
          if (error) {
            reject(error);
            return;
          }

          resolve(derivedKey);
        },
      );
    });
  }

  async hash(password: string): Promise<string> {
    try {
      const salt = randomBytes(this.saltLength);

      const derivedKey = await this.deriveKey(
        password,
        salt,
        this.cost,
        this.blockSize,
        this.parallelization,
      );

      return [
        'scrypt',
        this.cost,
        this.blockSize,
        this.parallelization,
        salt.toString('base64url'),
        derivedKey.toString('base64url'),
      ].join('$');
    } catch {
      throw new InternalServerErrorException(
        'Unable to process password',
      );
    }
  }

  async verify(
    password: string,
    storedHash: string,
  ): Promise<boolean> {
    try {
      const parts = storedHash.split('$');

      if (parts.length !== 6 || parts[0] !== 'scrypt') {
        return false;
      }

      const cost = Number(parts[1]);
      const blockSize = Number(parts[2]);
      const parallelization = Number(parts[3]);

      if (
        !Number.isSafeInteger(cost) ||
        cost < 16384 ||
        cost > 32768 ||
        !Number.isSafeInteger(blockSize) ||
        blockSize !== 8 ||
        !Number.isSafeInteger(parallelization) ||
        parallelization !== 3
      ) {
        return false;
      }

      const salt = Buffer.from(parts[4], 'base64url');
      const expectedHash = Buffer.from(parts[5], 'base64url');

      if (
        salt.length !== this.saltLength ||
        expectedHash.length !== this.keyLength
      ) {
        return false;
      }

      const actualHash = await this.deriveKey(
        password,
        salt,
        cost,
        blockSize,
        parallelization,
      );

      return timingSafeEqual(actualHash, expectedHash);
    } catch {
      return false;
    }
  }
}
