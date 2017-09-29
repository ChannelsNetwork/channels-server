class DummyService {
  constructor(core) {
    this._core = core;
  }

  getPreviewUrl(path) {
    if (path)
      return this._core.publicBase + "/preview/" + path;
    return "";
  }

  getPreviewCards() {
    const now = (new Date()).getTime();
    const result = [
      {
        id: 'p1',
        postedAt: now - 1000 * 60 * 5,
        by: {
          address: 'nyt',
          handle: 'nytimes',
          name: "New York Times",
          imageUrl: this.getPreviewUrl("nytimes.jpg"),
          isFollowing: false,
          isBlocked: false
        },
        summary: {
          imageUrl: this.getPreviewUrl("puerto_rico.jpg"),
          linkUrl: null,
          title: "The Devastation in Puerto Rico, as Seen From Above",
          text: "Last week, Hurricane Maria made landfall in Puerto Rico with winds of 155 miles an hour, leaving the United States commonwealth on the brink of a humanitarian crisis. The storm left 80 percent of crop value destroyed, 60 percent of the island without water and almost the entire island without power."
        },
        cardType: {
          project: null,
          iconUrl: this.getPreviewUrl("icon_article.jpg")
        },
        pricing: {
          promotionFee: 0,
          openFee: 0.25,
          openFeeUnits: 5
        },
        history: {
          revenue: 30.33,
          impressions: 0,
          opens: 121,
          likes: 1,
          dislikes: 2
        }
      },
      {
        id: 'p2',
        postedAt: now - 1000 * 60 * 34,
        by: {
          address: '80sgames',
          handle: '80sgames',
          name: "80's Games",
          imageUrl: this.getPreviewUrl("80s_games.png"),
          isFollowing: false,
          isBlocked: false
        },
        summary: {
          imageUrl: this.getPreviewUrl("galaga.png"),
          linkUrl: null,
          title: "Play Galaga",
          text: "The free online classic 80's arcade game"
        },
        cardType: {
          project: null,
          iconUrl: this.getPreviewUrl("icon_game.png")
        },
        pricing: {
          promotionFee: 0,
          openFee: 0.05,
          openFeeUnits: 1
        },
        history: {
          revenue: 4.67,
          impressions: 0,
          opens: 93,
          likes: 8,
          dislikes: 1
        }
      },
      {
        id: 'p3',
        postedAt: now - 1000 * 60 * 4000,
        by: {
          address: 'thrillist',
          handle: 'thrillist',
          name: "Thrillist",
          imageUrl: this.getPreviewUrl("thrillist.jpg"),
          isFollowing: false,
          isBlocked: false
        },
        summary: {
          imageUrl: this.getPreviewUrl("pizza_ring.jpg"),
          linkUrl: null,
          title: "Puff Pizza Ring",
          text: "Learn how to make this delicious treat"
        },
        cardType: {
          project: null,
          iconUrl: this.getPreviewUrl("icon_play.png")
        },
        pricing: {
          promotionFee: 0,
          openFee: 0.15,
          openFeeUnits: 3
        },
        history: {
          revenue: 3516.84,
          impressions: 0,
          opens: 23446,
          likes: 445,
          dislikes: 23
        }
      },
      {
        id: 'p4',
        postedAt: now - 1000 * 60 * 189,
        by: {
          address: 'jmodell',
          handle: 'jmodell',
          name: "Josh Modell",
          imageUrl: this.getPreviewUrl("josh_modell.jpg"),
          isFollowing: false,
          isBlocked: false
        },
        summary: {
          imageUrl: this.getPreviewUrl("the_national.png"),
          linkUrl: null,
          title: "The National doesn't rest on the excellent Sleep Well Beast",
          text: "Albums by The National are like your friendly neighborhood lush: In just an hour or so, they’re able to drink you under the table, say something profound enough to make the whole bar weep, then stumble out into the pre-dawn, proud and ashamed in equal measure."
        },
        cardType: {
          project: null,
          iconUrl: this.getPreviewUrl("icon_article.jpg")
        },
        pricing: {
          promotionFee: 0,
          openFee: 0.10,
          openFeeUnits: 2
        },
        history: {
          revenue: 36.90,
          impressions: 0,
          opens: 369,
          likes: 7,
          dislikes: 1
        }
      },
      {
        id: 'p5',
        postedAt: now - 1000 * 60 * 265,
        by: {
          address: 'nyt',
          handle: 'nytimes',
          name: "NY Times Crosswords",
          imageUrl: this.getPreviewUrl("nytimes.jpg"),
          isFollowing: false,
          isBlocked: false
        },
        summary: {
          imageUrl: this.getPreviewUrl("mini_crossword.jpg"),
          linkUrl: null,
          title: "Solemn Promise",
          text: "Solve this mini-crossword in one minute"
        },
        cardType: {
          project: null,
          iconUrl: this.getPreviewUrl("icon_crossword.jpg")
        },
        pricing: {
          promotionFee: 0,
          openFee: 0.10,
          openFeeUnits: 2
        },
        history: {
          revenue: 84.04,
          impressions: 0,
          opens: 840,
          likes: 16,
          dislikes: 1
        }
      },
      {
        id: 'a2',
        postedAt: now - 1000 * 60 * 984,
        by: {
          address: 'cbs',
          handle: 'cbs',
          name: "CBS",
          imageUrl: this.getPreviewUrl("cbs.jpg"),
          isFollowing: false,
          isBlocked: false
        },
        summary: {
          imageUrl: this.getPreviewUrl("tomb_raider.jpg"),
          linkUrl: null,
          title: "Tomb Raider",
          text: "Alicia Vikander is Lara Croft.  Coming soon in 3D."
        },
        cardType: {
          project: null,
          iconUrl: this.getPreviewUrl("icon_play.png")
        },
        pricing: {
          promotionFee: 0.11,
          openFee: -1,
          openFeeUnits: 0
        },
        history: {
          revenue: 0,
          impressions: 0,
          opens: 0,
          likes: 40,
          dislikes: 5
        }
      },
      {
        id: 'p6',
        postedAt: now - 1000 * 60 * 380,
        by: {
          address: 'tyler',
          handle: 'tyler',
          name: "Tyler McGrath",
          imageUrl: this.getPreviewUrl("tyler.jpg"),
          isFollowing: false,
          isBlocked: false
        },
        summary: {
          imageUrl: this.getPreviewUrl("ascension.jpg"),
          linkUrl: null,
          title: "Ascension",
          text: "An emerging life form must respond to the unstable and unforgiving terrain of a new home."
        },
        cardType: {
          project: null,
          iconUrl: this.getPreviewUrl("icon_play.png")
        },
        pricing: {
          promotionFee: 0,
          openFee: 0.40,
          openFeeUnits: 8
        },
        history: {
          revenue: 278.33,
          impressions: 0,
          opens: 696,
          likes: 13,
          dislikes: 1
        }
      },
      {
        id: 'p7',
        postedAt: now - 1000 * 60 * 2165,
        by: {
          address: '',
          handle: '',
          name: "",
          imageUrl: this.getPreviewUrl(""),
          isFollowing: false,
          isBlocked: false
        },
        summary: {
          imageUrl: this.getPreviewUrl("dangerous_road.png"),
          linkUrl: null,
          title: "My Drive on the Most Dangerous Road in the World",
          text: ""
        },
        cardType: {
          project: null,
          iconUrl: this.getPreviewUrl("icon_play.png")
        },
        pricing: {
          promotionFee: 0,
          openFee: 0.10,
          openFeeUnits: 2
        },
        history: {
          revenue: 77.76,
          impressions: 0,
          opens: 778,
          likes: 12,
          dislikes: 3
        }
      },
      {
        id: 'p8',
        postedAt: now - 1000 * 60 * 2286,
        by: {
          address: 'brightside',
          handle: 'brightside',
          name: "Bright Side",
          imageUrl: this.getPreviewUrl(""),
          isFollowing: false,
          isBlocked: false
        },
        summary: {
          imageUrl: this.getPreviewUrl("amsterdam.jpg"),
          linkUrl: null,
          title: "The 100 best photographs ever taken without photoshop",
          text: "According to BrightSide.me"
        },
        cardType: {
          project: null,
          iconUrl: this.getPreviewUrl("icon_photos.png")
        },
        pricing: {
          promotionFee: 0,
          openFee: 0.15,
          openFeeUnits: 3
        },
        history: {
          revenue: 596.67,
          impressions: 0,
          opens: 3978,
          likes: 76,
          dislikes: 4
        }
      },
      {
        id: 'p9',
        postedAt: now - 1000 * 60 * 3000,
        by: {
          address: 'aperrotta',
          handle: 'aperrotta',
          name: "Anthony Perrotta",
          imageUrl: this.getPreviewUrl(""),
          isFollowing: false,
          isBlocked: false
        },
        summary: {
          imageUrl: this.getPreviewUrl("rage_cover.jpg"),
          linkUrl: null,
          title: "Rage Against the Current",
          text: "It was late August and on the spur of the moment, Joseph and Gomez decided to go to the beach. They had already taken a few bowl hits in the car and now intended on topping that off with the six-pack they were lugging with them across the boardwalk, which looked out over the southern shore of Long Island. Although there was still a few hours of sunlight left, you could already catch a golden glimmer of light bouncing off the ocean's surface, as the water whittled away, little by little, at the sandy earth."
        },
        cardType: {
          project: null,
          iconUrl: this.getPreviewUrl("icon_book.png")
        },
        pricing: {
          promotionFee: 0,
          openFee: 0.30,
          openFeeUnits: 6
        },
        history: {
          revenue: 262.65,
          impressions: 0,
          opens: 875,
          likes: 15,
          dislikes: 3
        }
      },
      {
        id: 'p10',
        postedAt: now - 1000 * 60 * 54,
        by: {
          address: 'uhaque',
          handle: 'uhaque',
          name: "Umair Haque",
          imageUrl: this.getPreviewUrl("umair.jpg"),
          isFollowing: false,
          isBlocked: false
        },
        summary: {
          imageUrl: this.getPreviewUrl("uber_explosion.jpg"),
          linkUrl: null,
          title: "Five Things to Learn From Uber's Implosion",
          text: "How to Fail at the Future"
        },
        cardType: {
          project: null,
          iconUrl: this.getPreviewUrl("icon_article.jpg")
        },
        pricing: {
          promotionFee: 0,
          openFee: 0.10,
          openFeeUnits: 2
        },
        history: {
          revenue: 22.08,
          impressions: 0,
          opens: 221,
          likes: 3,
          dislikes: 1
        }
      },
      {
        id: 'a1',
        postedAt: now - 1000 * 60 * 137,
        by: {
          address: 'bluenile',
          handle: 'bluenile',
          name: "Blue Nile",
          imageUrl: this.getPreviewUrl("blue_nile.jpg"),
          isFollowing: false,
          isBlocked: false
        },
        summary: {
          imageUrl: this.getPreviewUrl("blue_nile_diamonds.jpg"),
          linkUrl: "https://www.bluenile.com",
          title: "New. Brilliant. Astor by Blue Nile",
          text: "Find the most beautiful diamonds in the world and build your own ring."
        },
        cardType: {
          project: null,
          iconUrl: this.getPreviewUrl("icon_link.png")
        },
        pricing: {
          promotionFee: 0.10,
          openFee: -0.50,
          openFeeUnits: 0
        },
        history: {
          revenue: 0,
          impressions: 0,
          opens: 85,
          likes: 1,
          dislikes: 4
        }
      },
      {
        id: 'p11',
        postedAt: now - 1000 * 60 * 4650,
        by: {
          address: 'jigsaw',
          handle: 'jigsaw',
          name: "Jigsaw",
          imageUrl: this.getPreviewUrl("jigsaw.jpg"),
          isFollowing: false,
          isBlocked: false
        },
        summary: {
          imageUrl: this.getPreviewUrl("unfiltered_news.jpg"),
          linkUrl: null,
          title: "The Latest Unfiltered News",
          text: "Explore news from around the world that are outside the mainstream media"
        },
        cardType: {
          project: null,
          iconUrl: this.getPreviewUrl("icon_interactive.png")
        },
        pricing: {
          promotionFee: 0,
          openFee: 0.20,
          openFeeUnits: 4
        },
        history: {
          revenue: 576.25,
          impressions: 0,
          opens: 2881,
          likes: 50,
          dislikes: 7
        }
      },
      {
        id: "p12",
        postedAt: now - 1000 * 60 * 5650,
        by: {
          address: "pyropodcast",
          handle: "pyropodcast",
          name: "Pyro Podcast",
          imageUrl: this.getPreviewUrl("podcast_handle.jpg"),
          isFollowing: false,
          isBlocked: false
        },
        summary: {
          imageUrl: this.getPreviewUrl("football_podcast.jpg"),
          linkUrl: null,
          title: "Pyro Podcast Show 285",
          text: "Foreshadowing Week 4"
        },
        cardType: {
          project: null,
          iconUrl: this.getPreviewUrl("icon_interactive.png")
        },
        pricing: {
          promotionFee: 0,
          openFee: 0.25,
          openFeeUnits: 3
        },
        history: {
          revenue: 201.24,
          impressions: 0,
          opens: 1342,
          likes: 24,
          dislikes: 2
        }
      }
    ];

    return result;
  }
}