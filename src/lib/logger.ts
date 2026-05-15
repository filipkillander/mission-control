import pino from 'pino'

const usePretty = process.env.NODE_ENV !== 'production' && process.env.MC_LOG_PRETTY === '1'

export const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  ...(usePretty && {
    transport: {
      target: 'pino-pretty',
      options: { colorize: true },
    },
  }),
})
