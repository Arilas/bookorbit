import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseIntPipe, Post, Req } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { FastifyRequest } from 'fastify';

import { Permission } from '@bookorbit/types';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ForbidPermission } from '../../common/decorators/forbid-permission.decorator';
import { RequirePrimaryAuthentication } from '../../common/decorators/require-primary-authentication.decorator';
import type { RequestUser } from '../../common/types/request-user';
import { AppPasswordService } from './app-password.service';
import { CreateAppPasswordDto } from './dto/create-app-password.dto';
import { RotateAppPasswordDto } from './dto/rotate-app-password.dto';

const ONE_MINUTE_MS = 60_000;

@Controller('auth/app-passwords')
@ForbidPermission(Permission.DemoRestricted, 'Demo-restricted account cannot edit account settings')
@RequirePrimaryAuthentication()
export class AppPasswordController {
  constructor(private readonly appPasswordService: AppPasswordService) {}

  @Get()
  list(@CurrentUser() user: RequestUser) {
    return this.appPasswordService.list(user.id);
  }

  @Post()
  @Throttle({ default: { limit: 5, ttl: ONE_MINUTE_MS } })
  @HttpCode(HttpStatus.CREATED)
  create(@CurrentUser() user: RequestUser, @Body() dto: CreateAppPasswordDto, @Req() req: FastifyRequest) {
    return this.appPasswordService.create(user, dto, req.ip);
  }

  @Post(':id/rotate')
  @Throttle({ default: { limit: 5, ttl: ONE_MINUTE_MS } })
  @HttpCode(HttpStatus.OK)
  rotate(@CurrentUser() user: RequestUser, @Param('id', ParseIntPipe) id: number, @Body() dto: RotateAppPasswordDto, @Req() req: FastifyRequest) {
    return this.appPasswordService.rotate(user, id, dto, req.ip);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  revoke(@CurrentUser() user: RequestUser, @Param('id', ParseIntPipe) id: number, @Req() req: FastifyRequest) {
    return this.appPasswordService.revoke(user, id, req.ip);
  }
}
