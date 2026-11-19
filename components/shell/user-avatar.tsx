import { Blobatar } from '@blobatar/react'
import 'blobatar/motion.css'

import { Avatar } from '@/components/base/avatar/avatar'

const AVATAR_SIZE = { xs: 20, sm: 24, md: 32, lg: 36 } as const

type UserAvatarSize = keyof typeof AVATAR_SIZE

interface UserAvatarProps {
  name?: string | null
  email?: string | null
  image?: string | null
  size?: UserAvatarSize
}

/** 有真实头像用图片，否则按用户身份生成稳定的 blobatar。 */
export function UserAvatar({
  name,
  email,
  image,
  size = 'sm',
}: UserAvatarProps) {
  if (image) {
    return <Avatar size={size} src={image} alt={name ?? email ?? ''} />
  }

  return (
    <Blobatar
      name={name?.trim() || email || 'anonymous'}
      traits={{ shape: 0.11 }}
      animate="always"
      size={AVATAR_SIZE[size]}
    />
  )
}
