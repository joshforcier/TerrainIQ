export interface ApplicationReminder {
  id: string
  name: string
  state: string
  species: string
  deadline: Date
  openDate?: Date | null
  applicationUrl?: string | null
}

export type GoalUnitSex = 'either' | 'cow' | 'bull'
export type GoalUnitWeapon = 'rifle' | 'archery' | 'muzzleloader'
export type GoalUnitSeasonType =
  | 'regular'
  | 'plains'
  | 'late'
  | 'early'
  | 'private_land'
  | 'specialty'

export interface GoalUnit {
  unit: string
  sex?: GoalUnitSex
  weapon?: GoalUnitWeapon
  seasonType?: GoalUnitSeasonType
  seasonNumber?: number
  huntCode?: string
}

export interface SpeciesPointData {
  bonus: number
  preference: number
  pointPurchased: boolean
  statusYear: number
  goalUnits?: GoalUnit[]
}

export interface StatePointData {
  [state: string]: {
    [species: string]: SpeciesPointData
  }
}

export interface ReminderPreferences {
  ids: string[]
  notes: Record<string, string>
  emailEnabled: boolean
  smsEnabled: boolean
  phone: string
}

export interface HuntCatalogEntry {
  unit: string
  sex: GoalUnitSex
  weapon: GoalUnitWeapon
  seasonType: GoalUnitSeasonType
  seasonNumber: number
  huntCode: string
}

export type DrawnOutAtValue =
  | { kind: 'points'; points: number }
  | { kind: 'none_drawn' }
  | { kind: 'na' }

export interface DrawnOutAt {
  adultRes?: DrawnOutAtValue | null
  adultNonRes?: DrawnOutAtValue | null
  youthRes?: DrawnOutAtValue | null
  youthNonRes?: DrawnOutAtValue | null
  lppUnrestricted?: DrawnOutAtValue | null
  lppRestricted?: DrawnOutAtValue | null
}

export interface DrawOddsDoc {
  state: string
  huntCode: string
  species: string
  unit: string
  sex: string
  weapon: string
  seasonType: string
  seasonNumber: number
  sourceYear: number
  drawnOutAt: DrawnOutAt | null
}
