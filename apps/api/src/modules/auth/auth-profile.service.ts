import { Injectable } from '@nestjs/common';

import { DatabaseService } from '../../common/database/database.service';
import { throwAuthInputError } from './auth.errors';
import { normalizeDisplayName } from './auth-input.policy';
import type { AuthSessionContext } from './auth-session.service';
import type { SessionUserDto } from './dto/auth-response.dto';
import type { UpdateProfileDto } from './dto/profile.dto';

@Injectable()
export class AuthProfileService {
  constructor(private readonly database: DatabaseService) {}

  get(session: AuthSessionContext): SessionUserDto {
    return {
      avatarFileId: session.user.avatarFileId,
      displayName: session.user.displayName,
      email: session.user.email,
      id: session.user.id,
    };
  }

  async update(session: AuthSessionContext, dto: UpdateProfileDto): Promise<SessionUserDto> {
    let displayName: string;
    try {
      displayName = normalizeDisplayName(dto.displayName);
    } catch (error) {
      return throwAuthInputError(error);
    }

    return this.database.client.user.update({
      data: { displayName },
      select: { avatarFileId: true, displayName: true, email: true, id: true },
      where: { id: session.user.id },
    });
  }
}
