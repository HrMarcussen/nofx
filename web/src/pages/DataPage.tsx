import { useLanguage } from '../contexts/LanguageContext'
import { CompetitionPage } from '../components/CompetitionPage'

/**
 * Data Page - Shows competition/leaderboard data from local backend
 * Previously pointed to external nofxos.ai service (now removed)
 */
export function DataPage() {
  const { language } = useLanguage()

  return (
    <div className="w-full min-h-screen" style={{ background: '#0B0E11' }}>
      <div className="max-w-[1920px] mx-auto px-6 py-8">
        {/* Page Header */}
        <div className="mb-8">
          <h1
            className="text-3xl font-bold mb-2"
            style={{ color: '#EAECEF' }}
          >
            {language === 'zh' ? '数据中心' : 'Data Center'}
          </h1>
          <p style={{ color: '#848E9C' }}>
            {language === 'zh'
              ? '实时交易数据和竞技场排名'
              : 'Live trading data and competition rankings'}
          </p>
        </div>

        {/* Competition/Leaderboard Component */}
        <CompetitionPage />
      </div>
    </div>
  )
}
