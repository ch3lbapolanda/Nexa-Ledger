import {
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import {
  AuthProvider,
  UserStatus,
} from '../../generated/prisma/client.js';

import { PrismaService } from '../../database/prisma.service.js';
import { PasswordHasherService } from '../identity/password-hasher.service.js';
import { LoginDto } from './dto/login.dto.js';
import { JwtPayload } from './interfaces/jwt-payload.interface.js';

@Injectable()
export class AuthenticationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly passwordHasher: PasswordHasherService,
    private readonly jwtService: JwtService,
  ) {}

  async login(dto: LoginDto) {
    const user = await this.prisma.user.findUnique({
      where: {
        email: dto.email,
      },
      include: {
        credentials: {
          where: {
            provider: AuthProvider.LOCAL,
          },
          select: {
            passwordHash: true,
          },
        },
      },
    });

    const passwordHash = user?.credentials[0]?.passwordHash;

    if (
      !user ||
      !passwordHash ||
      !(await this.passwordHasher.verify(dto.password, passwordHash))
    ) {
      throw new UnauthorizedException('Invalid email or password');
    }

    if (user.status === UserStatus.SUSPENDED) {
      throw new ForbiddenException('This account has been suspended');
    }

    if (user.status !== UserStatus.ACTIVE) {
      throw new ForbiddenException('This account is not active');
    }

    const payload: JwtPayload = {
      sub: user.id,
      email: user.email,
      role: user.role,
    };

    const accessToken = await this.jwtService.signAsync(payload);

    return {
      accessToken,
      tokenType: 'Bearer',
      expiresIn: 900,
      user: {
        id: user.id,
        email: user.email,
        fullName: user.fullName,
        role: user.role,
        status: user.status,
      },
    };
  }
}