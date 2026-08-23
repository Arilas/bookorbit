import { Module } from '@nestjs/common';

import { AppSettingsModule } from '../app-settings/app-settings.module';
import { ContentFilterRepository } from './content-filter.repository';
import { OidcIdentityRepository } from './oidc-identity.repository';
import { UserAvatarStorageService } from './user-avatar-storage.service';
import { UserAvatarService } from './user-avatar.service';
import { UserEventsService } from './user-events.service';
import { UserController } from './user.controller';
import { UserRepository } from './user.repository';
import { UserService } from './user.service';

@Module({
  imports: [AppSettingsModule],
  controllers: [UserController],
  providers: [
    UserService,
    UserRepository,
    UserAvatarService,
    UserAvatarStorageService,
    OidcIdentityRepository,
    ContentFilterRepository,
    UserEventsService,
  ],
  exports: [
    UserService,
    UserRepository,
    UserAvatarService,
    UserAvatarStorageService,
    OidcIdentityRepository,
    ContentFilterRepository,
    UserEventsService,
  ],
})
export class UserModule {}
