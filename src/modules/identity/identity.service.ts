import {
  ConflictException,
  Injectable,
} from '@nestjs/common';
import { AuthProvider, Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../database/prisma.service.js';
import { PasswordHasherService } from './password-hasher.service.js';
import { RegisterDto } from './dto/register.dto.js';

@Injectable()
export class IdentityService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly passwordHasher: PasswordHasherService,
  ) {}

  async register(dto: RegisterDto) {
    const email = dto.email;
    const passwordHash = await this.passwordHasher.hash(dto.password);

    try {
      const user = await this.prisma.user.create({
        data: {
          email,
          fullName: dto.fullName,
          credentials: {
            create: {
              provider: AuthProvider.LOCAL,
              providerUserId: email,
              passwordHash,
            },
          },
        },
        select: {
          id: true,
          email: true,
          fullName: true,
          role: true,
          status: true,
          createdAt: true,
        },
      });

      return user;
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException(
          'An account with this email already exists',
        );
      }

      throw error;
    }
  }
}
