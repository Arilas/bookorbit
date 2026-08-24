import { SetMetadata } from '@nestjs/common';

export const REQUIRE_PRIMARY_AUTHENTICATION_KEY = 'requirePrimaryAuthentication';

export const RequirePrimaryAuthentication = () => SetMetadata(REQUIRE_PRIMARY_AUTHENTICATION_KEY, true);
