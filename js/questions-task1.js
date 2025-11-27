// questions-task1.js
// Question data for Task 1

export const QUESTIONS = [
  {
    id: "q1",
    gradeLevel: "E",
    outcome: "PCE",
    topic: "7.1",
    correctAnswer: "C",
    blocks: [
      {
        type: "question",
        text: "Which tool would you use to measure the length of an object?",
      },
      {
        type: "image",
        src: "../images/q1.jpg",
        alt: "Measurement tools",
      },
    ],
    options: ["Thermometer", "Measuring cylinder", "Ruler", "Stopwatch"],
  },
  {
    id: "q2",
    gradeLevel: "E",
    outcome: "PCE",
    topic: "7.1",
    correctAnswer: "C",
    blocks: [
      {
        type: "question",
        text: "Which of your human senses would you use to determine the colour of an animal's fur?",
      },
    ],
    options: ["Touch.", "Taste.", "Sight.", "Smell."],
  },
  {
    id: "q3",
    gradeLevel: "E",
    outcome: "KU",
    topic: "7.1",
    correctAnswer: "B",
    blocks: [
      {
        type: "question",
        text: "What is the main purpose of science?",
      },
    ],
    options: [
      "To create fun experiments and activities.",
      "To understand the natural world using observations and evidence.",
      "To prove that every idea is correct.",
      "To make people agree with each other.",
    ],
  },
{
  id: "q4",
  gradeLevel: "E",
  outcome: "PS",
  topic: "7.1",
  correctAnswer: "B",

  terms: [
    {
      word: "fizzy drink",
      definition: "Sugary drinks like soft drink that contain dissolved carbon dioxide gas."
    },
    {
      word: "tooth decay",
      definition: "Damage caused to teeth by acids produced by bacteria."
    }
  ],

  blocks: [
    {
      type: "paragraph",
      text: "A student finds that teenagers who drank more fizzy drink had more tooth decay."
    },
    {
      type: "question",
      text: "Which statement is correct?"
    }
  ],

  options: [
    "The amount of tooth decay affects how much fizzy drink you drink.",
    "The amount of fizzy drink affects how much tooth decay you have.",
    "You should never drink fizzy drink.",
    "Fizzy drink does not affect your teeth."
  ]
},


  {
    id: "q5",
    gradeLevel: "E",
    outcome: "PS",
    topic: "7.1",
    correctAnswer: "D",
    blocks: [
      {
        type: "paragraph",
        text: "A student performed an experiment where they heated water in a beaker.",
      },
      {
        type: "question",
        text: "Which graph below shows the temperature of the water increasing over time?",
      },
      {
        type: "image",
        src: "../images/q5.jpg",
        alt: "Graphs showing different temperature changes over time.",
      },
    ],
    options: ["Graph A.", "Graph B.", "Graph C.", "Graph D."],
  },

  {
  id: "q6",
  gradeLevel: "D",
  outcome: "KU",
  topic: "7.1",
  correctAnswer: "B",

  terms: [
    { word: "equipment", definition: "Tools or items used to carry out a scientific task." }
  ],

  blocks: [
    {
      type: "question",
      text: "Which piece of equipment is best for measuring 50 mL of liquid?"
    },
    {
      type: "image",
      src: "../images/coming-soon.jpg",
      alt: "Measurement equipment"
    }
  ],

  options: [
    "Beaker",
    "Measuring cylinder",
    "Digital scales",
    "Evaporating basin"
  ]
},

{
  id: "q7",
  gradeLevel: "D",
  outcome: "KU",
  topic: "7.1",
  correctAnswer: "B",

  terms: [
    { word: "observations", definition: "Information gathered using your senses." }
  ],

  blocks: [
    {
      type: "paragraph",
      text: "A student sees bubbles forming and hears a fizzing sound when a tablet is placed into water."
    },
    {
      type: "question",
      text: "Which two senses are being used to make these observations?"
    }
  ],

  options: [
    "Touch and taste.",
    "Sight and hearing.",
    "Smell and sight.",
    "Hearing and taste."
  ]
},

{
  id: "q8",
  gradeLevel: "D",
  outcome: "KU",
  topic: "7.1",
  correctAnswer: "A",

  terms: [
    { word: "Observation", definition: "Using your senses to gather information." }
  ],

  blocks: [
    {
      type: "question",
      text: "How do scientists usually begin to build knowledge about the world?"
    }
  ],

  options: [
    "By making observations and asking questions.",
    "By guessing what might be true.",
    "By copying other scientists’ results.",
    "By making up ideas and theories."
  ]
},

{
  id: "q9",
  gradeLevel: "D",
  outcome: "KU",
  topic: "7.1",
  correctAnswer: "B",

  terms: [
    { 
      word: "Independent Variable", 
      definition: "The variable in an experiment that you deliberately change." 
    }
  ],

  blocks: [
    {
      type: "paragraph",
      text: "A student wants to test how sunlight affects the growth of their bean plants. They do an experiment to find out if bean plants grow taller when they get more sunlight."
    },
    {
      type: "question",
      text: "Which variable is the independent variable?"
    }
  ],

  options: [
    "The type of soil used.",
    "The amount of sunlight each plant receives.",
    "The size of the pots.",
    "The brand of fertiliser."
  ]
},

{
  id: "q10",
  gradeLevel: "D",
  outcome: "KU",
  topic: "7.1",
  correctAnswer: "C",

  terms: [
    { word: "Herbicide", definition: "A chemical that kills plants." }
  ],

  blocks: [
    {
      type: "paragraph",
      text: "A student grew a plant and measured its height each week. One day they accidentally watered it with herbicide, which killed the plant."
    },
    {
      type: "question",
      text: "In what week did they accidentally water the plant with herbicide?"
    },
    {
      type: "image",
      src: "../images/coming-soon.jpg",
      alt: "Plant growth graph"
    }
  ],

  options: [
    "Week 2",
    "Week 3",
    "Week 4",
    "Week 5"
  ]
},

{
  id: "q11",
  gradeLevel: "C",
  outcome: "KU",
  topic: "7.1",
  correctAnswer: "D",

  blocks: [
    {
      type: "paragraph",
      text: "You need to find out how the temperature of water affects how long it takes a Panadol tablet to dissolve."
    },
    {
      type: "question",
      text: "Which method below is the best?"
    }
  ],

  options: [
    "Heat the water, crush the tablet, estimate the time.",
    "Put a tablet in cold water, stir constantly, measure how hot it becomes.",
    "Start a timer, drop the tablet in water, measure colour every 10 seconds.",
    "Measure temperature → drop tablet → start timer → stop timer when dissolved → repeat."
  ]
},

{
  id: "q12",
  gradeLevel: "C",
  outcome: "KU",
  topic: "7.1",
  correctAnswer: "C",

  blocks: [
    {
      type: "paragraph",
      text: "A student observes a candle burning."
    },
    {
      type: "question",
      text: "Which is an observation made using sight?"
    }
  ],

  options: [
    "The wax feels warm when I touch it.",
    "I think the flame would go out if water is added.",
    "The wax melts and runs down the side of the candle.",
    "I think a fatter candle would burn longer."
  ]
},

{
  id: "q13",
  gradeLevel: "C",
  outcome: "KU",
  topic: "7.1",
  correctAnswer: "C",

  terms: [
    { word: "Observation", definition: "Using senses to gather information." },
    { word: "Experimentation", definition: "Testing ideas by performing practical investigations." },
    { word: "Analysis", definition: "Looking for patterns or relationships in results." }
  ],

  blocks: [
    {
      type: "question",
      text: "Which example best shows how scientists use observation, experimentation, and analysis?"
    }
  ],

  options: [
    "Guessing what will happen and writing it as fact.",
    "Reading a book and accepting everything that makes sense.",
    "Carrying out an experiment, recording results, and looking for patterns.",
    "Watching something once and deciding the cause."
  ]
},

{
  id: "q14",
  gradeLevel: "C",
  outcome: "KU",
  topic: "7.1",
  correctAnswer: "B",

  blocks: [
    {
      type: "paragraph",
      text: "A student investigates how temperature affects how quickly sugar dissolves."
    },
    {
      type: "question",
      text: "Which is the dependent variable that the student measures?"
    }
  ],

  options: [
    "The amount of sugar added",
    "The time taken for the sugar to dissolve",
    "The temperature of the water",
    "The number of times the mixture is stirred"
  ]
},

{
  id: "q15",
  gradeLevel: "C",
  outcome: "KU",
  topic: "7.1",
  correctAnswer: "D",

  blocks: [
    {
      type: "paragraph",
      text: "A student used four candles with different smells and measured their height every ten minutes."
    },
    {
      type: "question",
      text: "Which candle burned the longest before going out?"
    },
    {
      type: "image",
      src: "../images/coming-soon.jpg",
      alt: "Candle burn graph"
    }
  ],

  options: [
    "Vanilla",
    "Orange",
    "Cinnamon",
    "Lavender"
  ]
}

];
