export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type BillStatus = 'introduced' | 'in_committee' | 'passed_house' | 'passed_senate' | 'enacted' | 'vetoed'
export type BillChamber = 'house' | 'senate'
export type BillCategory = 'healthcare' | 'education' | 'environment' | 'economy' | 'civil_rights' | 'defense' | 'immigration' | 'technology' | 'housing' | 'infrastructure'
export type ProjectedOutcome = 'likely_pass' | 'likely_fail' | 'uncertain'
export type VoteType = 'yea' | 'nay'
export type FeedItemType = 'vote' | 'comment' | 'share'
export type LawRelationship = 'amends' | 'conflicts' | 'supports' | 'references'
export type Party = 'D' | 'R' | 'I'

export interface Database {
  public: {
    Tables: {
      system_settings: {
        Row: {
          key: string
          value: string
          description: string | null
          updated_at: string
        }
        Insert: {
          key: string
          value: string
          description?: string | null
          updated_at?: string
        }
        Update: {
          key?: string
          value?: string
          description?: string | null
          updated_at?: string
        }
      }
      profiles: {
        Row: {
          id: string
          username: string
          display_name: string
          email: string
          avatar: string | null
          bio: string | null
          location: string | null
          joined_date: string
          followers_count: number
          following_count: number
          votes_count: number
          created_at: string
          updated_at: string
        }
        Insert: {
          id: string
          username: string
          display_name: string
          email: string
          avatar?: string | null
          bio?: string | null
          location?: string | null
          joined_date?: string
          followers_count?: number
          following_count?: number
          votes_count?: number
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          username?: string
          display_name?: string
          email?: string
          avatar?: string | null
          bio?: string | null
          location?: string | null
          joined_date?: string
          followers_count?: number
          following_count?: number
          votes_count?: number
          created_at?: string
          updated_at?: string
        }
      }
      representatives: {
        Row: {
          id: string
          name: string
          party: Party
          state: string
          district: string | null
          chamber: BillChamber
          image_url: string | null
          contact_email: string | null
          contact_phone: string | null
          website: string | null
          twitter: string | null
          facebook: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          name: string
          party: Party
          state: string
          district?: string | null
          chamber: BillChamber
          image_url?: string | null
          contact_email?: string | null
          contact_phone?: string | null
          website?: string | null
          twitter?: string | null
          facebook?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          name?: string
          party?: Party
          state?: string
          district?: string | null
          chamber?: BillChamber
          image_url?: string | null
          contact_email?: string | null
          contact_phone?: string | null
          website?: string | null
          twitter?: string | null
          facebook?: string | null
          created_at?: string
          updated_at?: string
        }
      }
      bills: {
        Row: {
          id: string
          congress_number: number
          bill_number: string | null
          title: string
          short_title: string
          status: BillStatus
          chamber: BillChamber
          sponsor_id: string | null
          introduced_date: string
          last_action_date: string
          category: BillCategory
          full_text: string
          simplified_text: string | null
          real_world_impact: string | null
          projected_outcome: ProjectedOutcome
          yea_count: number
          nay_count: number
          total_votes: number
          official_yea: number | null
          official_nay: number | null
          official_present: number | null
          official_not_voting: number | null
          is_trending: boolean
          view_count: number
          cosponsor_count: number
          amendment_count: number
          weight_score: number
          weight_last_calculated: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          congress_number?: number
          bill_number?: string | null
          title: string
          short_title: string
          status?: BillStatus
          chamber: BillChamber
          sponsor_id?: string | null
          introduced_date?: string
          last_action_date?: string
          category: BillCategory
          full_text: string
          simplified_text?: string | null
          real_world_impact?: string | null
          projected_outcome?: ProjectedOutcome
          yea_count?: number
          nay_count?: number
          total_votes?: number
          official_yea?: number | null
          official_nay?: number | null
          official_present?: number | null
          official_not_voting?: number | null
          is_trending?: boolean
          view_count?: number
          cosponsor_count?: number
          amendment_count?: number
          weight_score?: number
          weight_last_calculated?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          congress_number?: number
          bill_number?: string | null
          title?: string
          short_title?: string
          status?: BillStatus
          chamber?: BillChamber
          sponsor_id?: string | null
          introduced_date?: string
          last_action_date?: string
          category?: BillCategory
          full_text?: string
          simplified_text?: string | null
          real_world_impact?: string | null
          projected_outcome?: ProjectedOutcome
          yea_count?: number
          nay_count?: number
          total_votes?: number
          official_yea?: number | null
          official_nay?: number | null
          official_present?: number | null
          official_not_voting?: number | null
          is_trending?: boolean
          view_count?: number
          cosponsor_count?: number
          amendment_count?: number
          weight_score?: number
          weight_last_calculated?: string | null
          created_at?: string
          updated_at?: string
        }
      }
      related_laws: {
        Row: {
          id: string
          bill_id: string
          law_name: string
          relationship: LawRelationship
          description: string | null
          created_at: string
        }
        Insert: {
          id?: string
          bill_id: string
          law_name: string
          relationship: LawRelationship
          description?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          bill_id?: string
          law_name?: string
          relationship?: LawRelationship
          description?: string | null
          created_at?: string
        }
      }
      votes: {
        Row: {
          id: string
          user_id: string
          bill_id: string
          vote: VoteType
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          user_id: string
          bill_id: string
          vote: VoteType
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          bill_id?: string
          vote?: VoteType
          created_at?: string
          updated_at?: string
        }
      }
      comments: {
        Row: {
          id: string
          user_id: string
          bill_id: string
          content: string
          likes_count: number
          parent_id: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          user_id: string
          bill_id: string
          content: string
          likes_count?: number
          parent_id?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          bill_id?: string
          content?: string
          likes_count?: number
          parent_id?: string | null
          created_at?: string
          updated_at?: string
        }
      }
      feed_items: {
        Row: {
          id: string
          type: FeedItemType
          user_id: string
          bill_id: string
          vote_id: string | null
          comment_id: string | null
          likes_count: number
          created_at: string
        }
        Insert: {
          id?: string
          type: FeedItemType
          user_id: string
          bill_id: string
          vote_id?: string | null
          comment_id?: string | null
          likes_count?: number
          created_at?: string
        }
        Update: {
          id?: string
          type?: FeedItemType
          user_id?: string
          bill_id?: string
          vote_id?: string | null
          comment_id?: string | null
          likes_count?: number
          created_at?: string
        }
      }
      feed_likes: {
        Row: {
          id: string
          user_id: string
          feed_item_id: string
          created_at: string
        }
        Insert: {
          id?: string
          user_id: string
          feed_item_id: string
          created_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          feed_item_id?: string
          created_at?: string
        }
      }
      follows: {
        Row: {
          id: string
          follower_id: string
          following_id: string
          created_at: string
        }
        Insert: {
          id?: string
          follower_id: string
          following_id: string
          created_at?: string
        }
        Update: {
          id?: string
          follower_id?: string
          following_id?: string
          created_at?: string
        }
      }
      delegations: {
        Row: {
          id: string
          from_user_id: string
          to_user_id: string
          category: BillCategory | null
          is_active: boolean
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          from_user_id: string
          to_user_id: string
          category?: BillCategory | null
          is_active?: boolean
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          from_user_id?: string
          to_user_id?: string
          category?: BillCategory | null
          is_active?: boolean
          created_at?: string
          updated_at?: string
        }
      }
      delegate_profiles: {
        Row: {
          id: string
          user_id: string
          expertise: BillCategory[]
          delegator_count: number
          total_votes: number
          yea_votes: number
          nay_votes: number
          bio: string | null
          is_featured: boolean
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          user_id: string
          expertise?: BillCategory[]
          delegator_count?: number
          total_votes?: number
          yea_votes?: number
          nay_votes?: number
          bio?: string | null
          is_featured?: boolean
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          expertise?: BillCategory[]
          delegator_count?: number
          total_votes?: number
          yea_votes?: number
          nay_votes?: number
          bio?: string | null
          is_featured?: boolean
          created_at?: string
          updated_at?: string
        }
      }
      bill_cache: {
        Row: {
          id: string
          search_query: string | null
          bill_id: string
          congress: number
          bill_type: string
          bill_number: number
          title: string
          short_title: string
          status: string
          category: string
          date: string
          source_url: string
          raw_text: string
          metadata: Json
          created_at: string
          expires_at: string
        }
        Insert: {
          id?: string
          search_query?: string | null
          bill_id: string
          congress: number
          bill_type: string
          bill_number: number
          title: string
          short_title: string
          status: string
          category: string
          date: string
          source_url: string
          raw_text: string
          metadata?: Json
          created_at?: string
          expires_at?: string
        }
        Update: {
          id?: string
          search_query?: string | null
          bill_id?: string
          congress?: number
          bill_type?: string
          bill_number?: number
          title?: string
          short_title?: string
          status?: string
          category?: string
          date?: string
          source_url?: string
          raw_text?: string
          metadata?: Json
          created_at?: string
          expires_at?: string
        }
      }
      timeline_posts: {
        Row: {
          id: string
          user_id: string
          bill_cache_id: string | null
          opinion: string | null
          likes_count: number
          shares_count: number
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          user_id: string
          bill_cache_id?: string | null
          opinion?: string | null
          likes_count?: number
          shares_count?: number
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          bill_cache_id?: string | null
          opinion?: string | null
          likes_count?: number
          shares_count?: number
          created_at?: string
          updated_at?: string
        }
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      search_bills: {
        Args: {
          search_query?: string | null
          filter_category?: BillCategory | null
          filter_status?: BillStatus | null
          sort_by?: string
          page_size?: number
          page_offset?: number
        }
        Returns: {
          id: string
          title: string
          short_title: string
          status: BillStatus
          chamber: BillChamber
          category: BillCategory
          simplified_text: string | null
          yea_count: number
          nay_count: number
          total_votes: number
          projected_outcome: ProjectedOutcome
          introduced_date: string
          is_trending: boolean
          sponsor_name: string | null
          sponsor_party: string | null
          sponsor_image: string | null
        }[]
      }
    }
    Enums: {
      bill_status: BillStatus
      bill_chamber: BillChamber
      bill_category: BillCategory
      projected_outcome: ProjectedOutcome
      vote_type: VoteType
      feed_item_type: FeedItemType
      law_relationship: LawRelationship
    }
  }
}

// Helper types for easier access
export type Profile = Database['public']['Tables']['profiles']['Row']
export type ProfileInsert = Database['public']['Tables']['profiles']['Insert']
export type ProfileUpdate = Database['public']['Tables']['profiles']['Update']

export type Representative = Database['public']['Tables']['representatives']['Row']
export type Bill = Database['public']['Tables']['bills']['Row']
export type Vote = Database['public']['Tables']['votes']['Row']
export type Comment = Database['public']['Tables']['comments']['Row']
export type FeedItem = Database['public']['Tables']['feed_items']['Row']
export type FeedLike = Database['public']['Tables']['feed_likes']['Row']
export type Follow = Database['public']['Tables']['follows']['Row']
export type Delegation = Database['public']['Tables']['delegations']['Row']
export type DelegateProfile = Database['public']['Tables']['delegate_profiles']['Row']
export type RelatedLaw = Database['public']['Tables']['related_laws']['Row']
export type BillCache = Database['public']['Tables']['bill_cache']['Row']
export type BillCacheInsert = Database['public']['Tables']['bill_cache']['Insert']
export type TimelinePostDB = Database['public']['Tables']['timeline_posts']['Row']
export type TimelinePostInsert = Database['public']['Tables']['timeline_posts']['Insert']

// Extended types with joins
export interface BillWithSponsor extends Bill {
  sponsor?: Representative | null
}

export interface FeedItemWithDetails extends FeedItem {
  user: Profile
  bill: Bill
  vote?: Vote | null
  comment?: Comment | null
  is_liked?: boolean
}

export interface VoteWithBill extends Vote {
  bill: Bill
}

export interface DelegateProfileWithUser extends DelegateProfile {
  user: Profile
}

// Timeline post with bill cache data (for SQL join)
export interface TimelinePostWithBill extends TimelinePostDB {
  bill_cache?: BillCache | null
  profiles?: Profile | null
}
