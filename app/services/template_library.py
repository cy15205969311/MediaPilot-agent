from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.models import Template


@dataclass(frozen=True)
class PresetTemplateSeed:
    id: str
    title: str
    description: str
    platform: str
    category: str
    knowledge_base_scope: str | None
    system_prompt: str


@dataclass(frozen=True)
class PresetScenario:
    slug: str
    title: str
    description: str
    platform: str
    focus: str
    knowledge_base_scope: str | None = None
    template_id: str | None = None


@dataclass(frozen=True)
class CategoryBlueprint:
    key: str
    label: str
    knowledge_base_scope: str
    role: str
    audience: str
    tone: str
    scenarios: tuple[PresetScenario, ...]


def _platform_output_guideline(platform: str) -> str:
    if platform == "小红书":
        return "请按小红书图文笔记结构输出，包含标题钩子、开场情绪切口、正文分段、清单或步骤，以及结尾互动 CTA。"
    if platform == "抖音":
        return "请按抖音短视频口播或脚本结构输出，包含 3 秒开场钩子、分镜节奏、字幕重点和结尾引导动作。"
    if platform == "双平台":
        return "请同时给出小红书图文版和抖音口播版的结构，并说明两端在节奏、措辞和 CTA 上的改写差异。"
    if platform == "闲鱼":
        return "请按高转化闲鱼发布文案结构输出，突出成色、原因、价格锚点、信任感和成交动作。"
    return "请按技术博客或长文结构输出，优先使用 Markdown，包含背景、步骤、关键判断、避坑点和扩展建议。"


def _build_system_prompt(
    blueprint: CategoryBlueprint,
    scenario: PresetScenario,
) -> str:
    scope = scenario.knowledge_base_scope or blueprint.knowledge_base_scope
    return (
        f"[Role]: {blueprint.role}。你当前负责的模板主题是《{scenario.title}》，熟悉 {blueprint.label} 赛道的内容增长逻辑与用户决策路径。\n"
        f"[Task]: 请围绕“{scenario.description}”完成内容策划，并重点处理以下任务重点：{scenario.focus}。\n"
        f"[Format]: {_platform_output_guideline(scenario.platform)} 输出时至少覆盖标题方向、开场切口、主体结构、证据细节、收尾 CTA 五个部分。\n"
        "[Variables]: [目标受众] [核心痛点] [场景/地点/产品] [证据细节] [风格语气] [转化动作] [风险提醒]\n"
        f"[Constraints]: 1. 目标受众以 {blueprint.audience} 为主。2. 全程保持 {blueprint.tone}。3. 必须输出可直接复用的内容骨架，不要空泛抒情。"
        "4. 如果涉及价格、功效、法律、医疗、金融或承诺性表达，必须主动补充边界提醒。"
        f"5. 推荐优先关联知识库作用域：{scope}。"
    )


CATEGORY_BLUEPRINTS: tuple[CategoryBlueprint, ...] = (
    CategoryBlueprint(
        key="beauty",
        label="美妆护肤",
        knowledge_base_scope="beauty_skin_repair_notes",
        role="你是一名懂成分、懂消费心理、也懂情绪价值的美妆护肤主编",
        audience="25-35 岁关注状态管理、预算效率和真实体验的女性用户",
        tone="专业、克制、有安慰感但不夸大",
        scenarios=(
            PresetScenario(
                slug="overnight-repair",
                template_id="template-preset-beauty-overnight-repair",
                title="熬夜党护肤急救方案",
                description="适合熬夜后浮肿、暗沉、卡粉场景的高情绪价值急救内容。",
                platform="小红书",
                focus="把症状识别、护肤顺序、避雷提醒和情绪安慰整合成能立刻照做的清单。",
            ),
            PresetScenario(
                slug="morning-c-evening-a",
                title="早 C 晚 A 科普拆解",
                description="把早 C 晚 A 写成新手也能跟上的实操型科普内容。",
                platform="双平台",
                focus="强调适用人群、建立顺序、叠加禁忌和耐受期提醒。",
            ),
            PresetScenario(
                slug="budget-dupe-lab",
                title="平替好物实验室",
                description="围绕大牌平替、预算友好、真实肤感做高信任种草。",
                platform="小红书",
                focus="突出肤质差异、使用场景、平替边界和不盲吹的判断标准。",
                knowledge_base_scope="beauty_dupe_lab",
            ),
            PresetScenario(
                slug="ingredient-hardcore",
                title="成分党硬核分析",
                description="适合把成分逻辑写成可理解、可选购的硬核拆解。",
                platform="技术博客",
                focus="解释成分作用、搭配逻辑、典型误区和选购判断。",
            ),
            PresetScenario(
                slug="immersive-unboxing",
                title="沉浸式开箱脚本",
                description="适合开箱、美妆包整理和上脸第一感受的沉浸式内容。",
                platform="抖音",
                focus="设计镜头节奏、第一印象、细节特写和结尾转化。",
            ),
            PresetScenario(
                slug="sensitive-skin-reset",
                title="敏感肌稳定期重建",
                description="适合换季、烂脸恢复和屏障修护场景。",
                platform="小红书",
                focus="把屏障修护写成安全、克制、低刺激的执行路线。",
            ),
            PresetScenario(
                slug="sunscreen-battle",
                title="防晒实测对打模板",
                description="适合户外通勤、防晒质地和妆前兼容性对比。",
                platform="双平台",
                focus="比较肤感、成膜速度、搓泥风险和补涂策略。",
            ),
            PresetScenario(
                slug="makeup-bag-reset",
                title="化妆包断舍离清单",
                description="适合换季整理、空瓶复盘和低频彩妆淘汰。",
                platform="小红书",
                focus="平衡实用性、预算回收、重复色管理和收纳逻辑。",
            ),
            PresetScenario(
                slug="acne-mark-recovery",
                title="痘痘肌恢复日记",
                description="适合痘痘反复、闭口爆发和淡印阶段内容。",
                platform="双平台",
                focus="让内容既有日记陪伴感，也有步骤感和边界感。",
            ),
            PresetScenario(
                slug="anti-aging-budget",
                title="轻熟龄抗老预算版",
                description="适合 28-35 岁用户做抗老入门与预算分配。",
                platform="小红书",
                focus="拆清楚轻抗老优先级、预算排序和长期坚持逻辑。",
            ),
        ),
    ),
    CategoryBlueprint(
        key="travel",
        label="美食文旅",
        knowledge_base_scope="travel_local_guides",
        role="你是一名擅长把在地体验写成高收藏笔记的文旅策划主编",
        audience="20-35 岁追求出片、性价比、路线清晰和真实体验的人群",
        tone="鲜活、有现场感、有烟火气但不浮夸",
        scenarios=(
            PresetScenario(
                slug="travel-hotflow",
                template_id="template-preset-travel-hotflow",
                title="文旅探店爆款流",
                description="突出情绪价值与在地体验，适合周末短途游和本地生活探店。",
                platform="小红书",
                focus="把价格、路线、氛围和出片点组合成一篇强收藏感笔记。",
            ),
            PresetScenario(
                slug="citywalk-weekend",
                template_id="template-preset-citywalk-weekend",
                title="周末特种兵 Citywalk",
                description="适合半天或一天走完的城市轻旅行路线。",
                platform="双平台",
                focus="突出路线效率、预算感、交通方式和情绪转折。",
                knowledge_base_scope="citywalk_scene_bank",
            ),
            PresetScenario(
                slug="locals-secret-food",
                title="本地人私藏探店",
                description="把本地人才知道的馆子写成强信任、少广告味的探店内容。",
                platform="小红书",
                focus="写出店铺选择逻辑、点单策略、踩雷提醒和适合谁去。",
            ),
            PresetScenario(
                slug="night-market-50",
                title="人均 50 吃垮夜市",
                description="适合夜市、商圈、美食街的预算型打卡内容。",
                platform="双平台",
                focus="强化预算、排队窗口、必吃排序和避雷项。",
                knowledge_base_scope="local_food_hotspots",
            ),
            PresetScenario(
                slug="fine-dining-avoid",
                title="高端法餐避雷指南",
                description="把高客单餐厅体验拆成值不值、适合谁、怎么点。",
                platform="小红书",
                focus="避免空洞夸赞，强调氛围、服务、菜品稳定性和性价比。",
            ),
            PresetScenario(
                slug="railway-old-town",
                title="高铁直达小众古镇",
                description="适合高铁可达、周末短逃离、小众古镇路线。",
                platform="双平台",
                focus="突出交通便利、拍照时段、住宿建议和避人流策略。",
            ),
            PresetScenario(
                slug="museum-date-route",
                title="博物馆约会路线",
                description="适合情侣、朋友或 solo date 的展览路线内容。",
                platform="小红书",
                focus="平衡文化信息、路线安排、休息点和情绪氛围。",
            ),
            PresetScenario(
                slug="county-food-drive",
                title="县城美食自驾路线",
                description="适合下沉市场、县城烟火气和一日自驾打卡内容。",
                platform="抖音",
                focus="让路线、车程、餐点顺序和当地反差感更有记忆点。",
            ),
            PresetScenario(
                slug="rainy-day-plan",
                title="下雨天城市备用方案",
                description="适合坏天气、临时改路线和低风险出行内容。",
                platform="小红书",
                focus="强调应急改线、室内替代点和时间利用率。",
            ),
            PresetScenario(
                slug="hotel-breakfast-score",
                title="酒店早餐值回票价模板",
                description="适合酒店测评、周边 staycation 和短住体验。",
                platform="双平台",
                focus="比较早餐、睡眠体验、位置便利和加价是否值得。",
            ),
        ),
    ),
    CategoryBlueprint(
        key="finance",
        label="职场金融",
        knowledge_base_scope="finance_recovery_playbook",
        role="你是一名把钱、职业和现实压力讲得清楚又不制造羞耻感的增长主编",
        audience="25-35 岁同时面对预算焦虑、职业竞争和生活成本压力的人群",
        tone="真诚、克制、务实，有方法感但不喊口号",
        scenarios=(
            PresetScenario(
                slug="finance-recovery",
                template_id="template-preset-finance-recovery",
                title="精致穷回血理财方案",
                description="适合女性用户做预算、回血、现金流整理的温柔理财内容。",
                platform="小红书",
                focus="把焦虑共鸣、预算拆解、风险边界和一周可执行动作写清楚。",
            ),
            PresetScenario(
                slug="salary-side-income",
                title="月薪八千搞钱副业清单",
                description="适合副业选择、时间分配和试错成本分析。",
                platform="双平台",
                focus="给出靠谱门槛、回报周期和踩坑提醒，不鼓吹暴富。",
            ),
            PresetScenario(
                slug="big-tech-interview",
                title="大厂面试复盘脚本",
                description="适合求职、转岗和涨薪前的项目叙事整理。",
                platform="抖音",
                focus="把 STAR、亮点提炼、复盘反思和同龄焦虑结合起来。",
                knowledge_base_scope="career_interview_cases",
            ),
            PresetScenario(
                slug="resign-at-28",
                title="28 岁裸辞复盘日记",
                description="适合职业转折、自我怀疑和重新出发类内容。",
                platform="小红书",
                focus="兼顾情绪共鸣、风险评估、现金流准备和阶段目标。",
            ),
            PresetScenario(
                slug="social-security-guide",
                title="社保公积金讲透模板",
                description="把社保、公积金和个税常见误区讲给普通人听。",
                platform="双平台",
                focus="强调适用场景、关键概念、误区和行动入口。",
            ),
            PresetScenario(
                slug="fund-dca",
                title="基金定投避坑框架",
                description="适合长期定投、风险承受和情绪波动管理。",
                platform="小红书",
                focus="拆清楚定投节奏、止损误区和心态边界。",
            ),
            PresetScenario(
                slug="legal-risk-qa",
                template_id="template-preset-legal-risk-qa",
                title="劳动合同避坑问答卡",
                description="适合法律边界、合同谈判和离职风险提示。",
                platform="小红书",
                focus="用清晰问答结构解释合同条款、证据意识和风险提醒。",
                knowledge_base_scope="legal_common_qa",
            ),
            PresetScenario(
                slug="salary-reset",
                title="工资到账预算重启术",
                description="适合月初预算、账单复盘和消费降噪内容。",
                platform="小红书",
                focus="突出冻结清单、保留清单、奖励机制和现金流秩序。",
                knowledge_base_scope="monthly_budget_reset",
            ),
            PresetScenario(
                slug="credit-card-debt",
                title="信用卡负债止血模板",
                description="适合负债自救、账单重整和延迟满足训练。",
                platform="双平台",
                focus="用阶段方案代替羞耻叙事，突出止血优先级。",
            ),
            PresetScenario(
                slug="promotion-negotiation",
                title="涨薪谈判开口模板",
                description="适合晋升评估、成果量化和向上沟通。",
                platform="抖音",
                focus="拆解成果证据、时机判断和谈判边界。",
                knowledge_base_scope="career_upgrade_map",
            ),
        ),
    ),
    CategoryBlueprint(
        key="tech",
        label="数码科技",
        knowledge_base_scope="iot_embedded_lab",
        role="你是一名既懂工程细节也懂大众表达的数码科技内容主编",
        audience="技术控、效率党、数码消费决策者与程序员群体",
        tone="硬核、清晰、可复现，不装神秘",
        scenarios=(
            PresetScenario(
                slug="iot-markdown",
                template_id="template-preset-tech-iot-markdown",
                title="STM32 / IoT 硬核教程模板",
                description="适合单片机、传感器、嵌入式联调和跨平台工程实践分享。",
                platform="技术博客",
                focus="明确环境、步骤、代码边界、日志、问题定位和验证方式。",
            ),
            PresetScenario(
                slug="apple-android-review",
                title="苹果安卓深度评测",
                description="把手机体验写成系统、影像、续航和生态的实战对比。",
                platform="双平台",
                focus="用具体场景比较优缺点，而不是空泛参数对轰。",
            ),
            PresetScenario(
                slug="desk-setup",
                title="桌面改造沉浸式脚本",
                description="适合程序员工位、创作者桌面和效率空间改造。",
                platform="抖音",
                focus="强化前后反差、器材理由、氛围细节和实用性。",
            ),
            PresetScenario(
                slug="productivity-software",
                title="程序员效率软件清单",
                description="适合软件栈、插件流和自动化工作流分享。",
                platform="技术博客",
                focus="讲清楚痛点、组合方式、配置要点和边界成本。",
                knowledge_base_scope="ai_productivity_stack",
            ),
            PresetScenario(
                slug="smart-home-review",
                template_id="template-preset-smart-home-review",
                title="智能家居避坑评测",
                description="适合门锁、摄像头、扫地机和联动系统的家庭场景评测。",
                platform="双平台",
                focus="比较安装难度、联动深度、隐私风险和长期维护成本。",
                knowledge_base_scope="smart_home_reviews",
            ),
            PresetScenario(
                slug="ai-efficiency-stack",
                template_id="template-preset-ai-efficiency-stack",
                title="AI 效率软件工作流",
                description="适合 AI 工具组合、自动化协作和内容生产流水线。",
                platform="技术博客",
                focus="突出工具编排、复制门槛、收益点和踩坑提醒。",
                knowledge_base_scope="ai_productivity_stack",
            ),
            PresetScenario(
                slug="devboard-lab-notes",
                template_id="template-preset-devboard-lab-notes",
                title="开发板实验记录模板",
                description="适合开发板、驱动调试、串口日志和实验复盘。",
                platform="技术博客",
                focus="沉淀问题现象、排查链路和验证闭环。",
                knowledge_base_scope="embedded_lab_notebook",
            ),
            PresetScenario(
                slug="camera-phone-shootout",
                title="影像旗舰横评脚本",
                description="适合夜景、人像、视频防抖和出片色彩对比。",
                platform="双平台",
                focus="让评测更像真实拍摄场景，而不是参数复读。",
            ),
            PresetScenario(
                slug="gaming-laptop-budget",
                title="游戏本预算避坑表",
                description="适合学生党和入门创作者的配置选择内容。",
                platform="抖音",
                focus="把配置、噪音、发热、便携和价格边界讲透。",
            ),
            PresetScenario(
                slug="nas-backup-beginner",
                title="家庭 NAS 备份入门",
                description="适合照片归档、家庭数据管理和轻量私有云内容。",
                platform="技术博客",
                focus="解释设备选择、目录结构、备份策略和新手误区。",
            ),
        ),
    ),
    CategoryBlueprint(
        key="commerce",
        label="电商/闲鱼",
        knowledge_base_scope="secondhand_trade_playbook",
        role="你是一名既懂成交节奏也懂用户信任建立的电商与闲鱼运营主编",
        audience="预算敏感、需要回血、重视价格解释和信任感的消费决策人群",
        tone="真诚、清晰、强执行，不玩虚的",
        scenarios=(
            PresetScenario(
                slug="secondhand-sku",
                template_id="template-preset-xianyu-secondhand-sku",
                title="高转化二手闲置 SKU",
                description="适合闲鱼二手回血、断舍离和高信任成交文案。",
                platform="闲鱼",
                focus="把成色、理由、价格锚点和交易信任感写得具体可信。",
            ),
            PresetScenario(
                slug="declutter-recovery",
                template_id="template-preset-declutter-recovery",
                title="断舍离回血清单",
                description="适合批量出物、分类打包和回血复盘内容。",
                platform="闲鱼",
                focus="提高整理效率、分类逻辑、成交节奏和买家信任。",
                knowledge_base_scope="declutter_recovery_board",
            ),
            PresetScenario(
                slug="pdd-no-stock",
                title="拼多多无货源教程",
                description="适合轻创业、新手卖货和平台规则边界内容。",
                platform="双平台",
                focus="强调供应链判断、选品、风险边界和执行门槛。",
            ),
            PresetScenario(
                slug="factory-store-1688",
                title="1688 工厂店挖掘术",
                description="适合供应链选品、工厂筛选和拿货避坑内容。",
                platform="小红书",
                focus="用清单式表达讲清楚筛选逻辑和对接话术。",
            ),
            PresetScenario(
                slug="shopping-festival-list",
                title="大促囤货清单模板",
                description="适合双十一、618 和阶段性囤货决策内容。",
                platform="双平台",
                focus="比较刚需、折扣机制、替代品和踩坑清单。",
            ),
            PresetScenario(
                slug="secondhand-digital",
                template_id="template-preset-secondhand-digital",
                title="二手数码估价描述",
                description="适合耳机、相机、平板、游戏机等二手数码发布。",
                platform="闲鱼",
                focus="突出成色等级、配件、购买渠道和适合谁买。",
                knowledge_base_scope="secondhand_digital_guide",
            ),
            PresetScenario(
                slug="private-domain-deal",
                template_id="template-preset-private-domain-deal",
                title="私域追单成交话术",
                description="适合从公域导流到私域后的跟进与转化内容。",
                platform="双平台",
                focus="把首轮回复、补充说明、催化动作和边界感写顺。",
                knowledge_base_scope="private_domain_followup",
            ),
            PresetScenario(
                slug="luxury-resale",
                title="轻奢二手信任模板",
                description="适合高客单闲置、轻奢包表和成色说明内容。",
                platform="闲鱼",
                focus="强化真假证明、使用痕迹、成交安全和价格解释。",
            ),
            PresetScenario(
                slug="coupon-stack",
                title="优惠券叠加打法",
                description="适合低价捡漏、凑单和促销路径拆解内容。",
                platform="抖音",
                focus="突出时效性、计算逻辑和不被套路的判断。",
            ),
            PresetScenario(
                slug="listing-cover-optimize",
                title="商品首图点击优化",
                description="适合提升首图、标题、卖点和停留时长的运营模板。",
                platform="双平台",
                focus="把首图构图、前 3 秒卖点和转化动线写成标准动作。",
            ),
        ),
    ),
    CategoryBlueprint(
        key="education",
        label="教育/干货",
        knowledge_base_scope="education_score_boost",
        role="你是一名擅长把复杂方法讲成可执行步骤的教育干货主编",
        audience="学生、家长、考证人群以及想系统学习技能的职场用户",
        tone="清晰、负责、有方法感，不灌鸡汤",
        scenarios=(
            PresetScenario(
                slug="score-boost",
                template_id="template-preset-education-score-boost",
                title="高中逆袭提分模板",
                description="适合教辅资料、提分计划和家长沟通内容。",
                platform="抖音",
                focus="写清楚分数差距、适用人群、方法步骤和执行窗口。",
            ),
            PresetScenario(
                slug="gaokao-sprint",
                template_id="template-preset-high-school-cram",
                title="高考冲刺计划卡",
                description="适合高三阶段的提效、复盘和日程管理内容。",
                platform="双平台",
                focus="把时间分配、科目优先级和情绪管理合成冲刺框架。",
                knowledge_base_scope="gaokao_sprint_plan",
            ),
            PresetScenario(
                slug="ielts-toefl",
                title="雅思托福上岸经验",
                description="适合语言考试、备考计划和阶段复盘内容。",
                platform="小红书",
                focus="强调基础水平、提分阶段、资料路径和常见误区。",
            ),
            PresetScenario(
                slug="ai-tools-howto",
                title="AI 工具使用教程",
                description="适合从零教用户如何把 AI 工具真正用进工作学习。",
                platform="技术博客",
                focus="讲清楚使用场景、输入方法、效果边界和复制路径。",
            ),
            PresetScenario(
                slug="pomodoro-focus",
                title="番茄工作法落地模版",
                description="适合时间管理、专注力提升和拖延自救内容。",
                platform="双平台",
                focus="兼顾方法拆解、执行环境和复盘反馈。",
            ),
            PresetScenario(
                slug="exam-material-share",
                title="考研考公资料分享",
                description="适合资料筛选、复习规划和避坑提醒内容。",
                platform="小红书",
                focus="突出资料边界、时间线、优先级和资源真假判断。",
            ),
            PresetScenario(
                slug="learning-method-review",
                template_id="template-preset-learning-method-review",
                title="学习方法复盘模板",
                description="适合错题复盘、学习习惯重建和提效方法分享。",
                platform="小红书",
                focus="用可执行替代空泛努力，把方法写成照做清单。",
                knowledge_base_scope="study_method_reviews",
            ),
            PresetScenario(
                slug="medical-pop-science",
                template_id="template-preset-medical-pop-science",
                title="医疗科普三分钟",
                description="适合健康误区、就医建议和疾病常识内容。",
                platform="抖音",
                focus="强调边界、易懂表达、就医提醒和风险提示。",
                knowledge_base_scope="medical_pop_science",
            ),
            PresetScenario(
                slug="public-exam",
                title="考公上岸节奏表",
                description="适合公考备考、岗位选择和阶段自测内容。",
                platform="双平台",
                focus="讲清楚岗位筛选、刷题节奏和心态管理。",
            ),
            PresetScenario(
                slug="office-software-skills",
                title="办公软件提效课",
                description="适合 Excel、PPT、Notion 等效率技能教程。",
                platform="技术博客",
                focus="从痛点出发，给出快捷操作、案例和练习路径。",
            ),
        ),
    ),
    CategoryBlueprint(
        key="housing",
        label="房产/家居",
        knowledge_base_scope="housing_home_revival",
        role="你是一名懂房产决策也懂生活方式表达的家居与居住赛道主编",
        audience="首次置业、租房党、改善型住户和热爱家居改造的人群",
        tone="理性、具体、带生活感，不夸大收益",
        scenarios=(
            PresetScenario(
                slug="foreclosure-guide",
                title="法拍房捡漏指南",
                description="适合法拍房、小白入局和风险边界科普内容。",
                platform="小红书",
                focus="讲清流程、成本、雷区、证据核验和适合谁做。",
            ),
            PresetScenario(
                slug="cream-style-renovation",
                title="奶油风极简装修",
                description="适合风格搭建、预算拆分和软硬装协同内容。",
                platform="双平台",
                focus="平衡氛围感、材料选择、预算和落地难度。",
            ),
            PresetScenario(
                slug="rental-contract",
                title="租房避坑条款清单",
                description="适合签约前核验、押金、转租和维修责任内容。",
                platform="小红书",
                focus="突出必看条款、拍照留证和争议应对。",
            ),
            PresetScenario(
                slug="soft-furnishing-list",
                title="软装好物搭配单",
                description="适合新家入住、风格统一和预算型布置内容。",
                platform="小红书",
                focus="强调质感、空间比例、预算优先级和耐看性。",
            ),
            PresetScenario(
                slug="old-house-makeover",
                title="老破小改造复盘",
                description="适合旧房翻新、空间优化和收纳改造内容。",
                platform="双平台",
                focus="体现前后反差、成本控制和功能区重组。",
            ),
            PresetScenario(
                slug="first-home-budget",
                title="首套房预算测算模板",
                description="适合买房前预算、月供压力和选择边界内容。",
                platform="小红书",
                focus="讲清首付、税费、装修和持有成本。",
            ),
            PresetScenario(
                slug="storage-upgrade",
                title="小户型收纳动线",
                description="适合小空间扩容和日常收纳提效内容。",
                platform="双平台",
                focus="把动线、分区、拿取频率和颜值统一起来。",
            ),
            PresetScenario(
                slug="appliance-buying",
                title="家电避坑决策表",
                description="适合买前攻略、型号选择和参数翻译内容。",
                platform="抖音",
                focus="把参数翻译成人话，突出真实使用场景。",
            ),
            PresetScenario(
                slug="sleep-bedroom",
                title="卧室睡眠感升级",
                description="适合卧室灯光、床品、隔音和氛围改造内容。",
                platform="小红书",
                focus="兼顾实用改善、情绪价值和长期稳定感。",
            ),
            PresetScenario(
                slug="move-in-checklist",
                title="新房入住检查清单",
                description="适合交房验收、入住准备和长期维护内容。",
                platform="双平台",
                focus="把验收流程、工具和优先排查项写成清单。",
            ),
        ),
    ),
    CategoryBlueprint(
        key="automotive",
        label="汽车/出行",
        knowledge_base_scope="car_lifestyle_commuter",
        role="你是一名懂用车决策、成本核算和真实场景表达的汽车主编",
        audience="首次买车、通勤升级、自驾爱好者和新能源观望人群",
        tone="真实、冷静、有对比意识，不替用户拍脑袋",
        scenarios=(
            PresetScenario(
                slug="ev-test-drive",
                title="新能源车试驾体验",
                description="适合首试电车、城市通勤和家庭用车对比。",
                platform="双平台",
                focus="写清楚驾驶感、空间、补能和智能化体验。",
            ),
            PresetScenario(
                slug="first-commuter-car",
                title="第一辆代步车推荐",
                description="适合预算型、通勤型和新手友好型选车内容。",
                platform="小红书",
                focus="比较预算、保值、稳定性和适合人群。",
            ),
            PresetScenario(
                slug="roadtrip-planner",
                title="自驾游路线规划",
                description="适合长途自驾、周末露营和节假日出行内容。",
                platform="双平台",
                focus="兼顾路线、补能、住宿、天气和人流规避。",
            ),
            PresetScenario(
                slug="used-car-inspection",
                title="二手车验车秘籍",
                description="适合小白看车、试车和交易避坑内容。",
                platform="抖音",
                focus="强调车况判断、事故痕迹、文件核验和交易边界。",
            ),
            PresetScenario(
                slug="fuel-cost-breakdown",
                title="油耗保养成本揭秘",
                description="适合养车成本、车型差异和长期持有计算内容。",
                platform="小红书",
                focus="把保险、油耗、保养和停车开销拆成真实账本。",
            ),
            PresetScenario(
                slug="commute-ranking",
                title="城市通勤车横评",
                description="适合小车、 SUV、插混和纯电对比内容。",
                platform="双平台",
                focus="基于通勤半径、停车条件和补能便利做比较。",
            ),
            PresetScenario(
                slug="charging-guide",
                title="充电桩安装避坑",
                description="适合新能源车主的安装、申请和长期使用内容。",
                platform="小红书",
                focus="讲清安装条件、物业沟通和费用边界。",
            ),
            PresetScenario(
                slug="family-suv",
                title="家用 SUV 对比模板",
                description="适合家庭成员多、带娃出行和空间需求场景。",
                platform="抖音",
                focus="突出空间、儿童座椅、后备箱和长途舒适度。",
            ),
            PresetScenario(
                slug="camping-car",
                title="周末露营车选择",
                description="适合露营、自驾和轻越野生活方式内容。",
                platform="小红书",
                focus="把装载能力、能耗、路况和露营便利讲清楚。",
            ),
            PresetScenario(
                slug="maintenance-schedule",
                title="保养节奏提醒模板",
                description="适合保养时机、项目选择和不被过度推荐的内容。",
                platform="双平台",
                focus="让小白知道什么时候该做、什么时候不用做。",
            ),
        ),
    ),
    CategoryBlueprint(
        key="family",
        label="母婴/宠物",
        knowledge_base_scope="parenting_pet_care",
        role="你是一名既有照护经验又尊重现实压力的母婴宠物内容主编",
        audience="新手父母、养宠家庭、精力有限但想把照护做好的人群",
        tone="耐心、温和、细节丰富，但不制造焦虑",
        scenarios=(
            PresetScenario(
                slug="new-mom-shopping",
                title="新手妈妈囤货雷区",
                description="适合产前准备、预算控制和用品优先级内容。",
                platform="小红书",
                focus="区分刚需与伪需求，减少焦虑型囤货。",
            ),
            PresetScenario(
                slug="kitten-puppy-arrival",
                title="幼猫幼犬接回家指南",
                description="适合接宠前准备、环境适应和新手错误预防。",
                platform="双平台",
                focus="讲清环境布置、第一周观察点和应急清单。",
            ),
            PresetScenario(
                slug="scientific-feeding",
                title="科学喂养模板",
                description="适合婴儿辅食、猫饭狗粮和喂养节奏内容。",
                platform="小红书",
                focus="把营养逻辑、频次、份量和禁忌讲明白。",
            ),
            PresetScenario(
                slug="sleep-training",
                title="睡渣宝宝哄睡法",
                description="适合睡眠节律混乱、安抚困难和家长崩溃场景。",
                platform="抖音",
                focus="兼顾方法、情绪共情、可执行步骤和边界提醒。",
            ),
            PresetScenario(
                slug="pet-friendly-cafe",
                title="宠物友好餐厅打卡",
                description="适合养宠社交、外出路线和宠物友好清单内容。",
                platform="小红书",
                focus="写清规则、空间舒适度、店员友好度和拍照体验。",
            ),
            PresetScenario(
                slug="baby-food-intro",
                title="辅食添加阶段表",
                description="适合月龄对应、食材引入和过敏观察内容。",
                platform="双平台",
                focus="把节奏、观察指标和家长常见误区说清楚。",
            ),
            PresetScenario(
                slug="daycare-anxiety",
                title="送托焦虑过渡模板",
                description="适合幼儿入园、分离焦虑和家长准备内容。",
                platform="小红书",
                focus="兼顾孩子适应、家长心态和过渡期动作。",
            ),
            PresetScenario(
                slug="cat-litter-upgrade",
                title="猫砂盆升级日记",
                description="适合养猫环境优化、异味管理和清洁提效内容。",
                platform="抖音",
                focus="突出前后反差、体验变化和细节选择逻辑。",
            ),
            PresetScenario(
                slug="postpartum-routine",
                title="产后作息修复模板",
                description="适合产后恢复、家庭分工和自我照护内容。",
                platform="小红书",
                focus="不制造完美妈妈压力，而是强调可持续恢复。",
            ),
            PresetScenario(
                slug="family-travel-pets",
                title="带宠亲子出行清单",
                description="适合家庭出游、车载装备和多角色协同内容。",
                platform="双平台",
                focus="平衡孩子、宠物和大人的节奏与安全感。",
            ),
        ),
    ),
    CategoryBlueprint(
        key="emotion",
        label="情感/心理",
        knowledge_base_scope="emotional_wellbeing_notes",
        role="你是一名把情绪、关系和自我边界讲得清醒又有温度的心理向主编",
        audience="容易自我苛责、在人际关系里消耗、需要情绪支持和方法感的年轻人",
        tone="真诚、柔软、有边界，不煽动对立",
        scenarios=(
            PresetScenario(
                slug="people-pleaser",
                title="讨好型人格自救",
                description="适合边界建立、拒绝练习和自我价值重建内容。",
                platform="小红书",
                focus="既给共鸣，也给具体练习，不把问题浪漫化。",
            ),
            PresetScenario(
                slug="peer-anxiety",
                title="同龄人焦虑缓解指南",
                description="适合职业、收入、关系和人生节奏焦虑内容。",
                platform="双平台",
                focus="把焦虑拆成可观察问题和可执行动作。",
            ),
            PresetScenario(
                slug="infj-infp",
                title="INFJ / INFP 性格解析",
                description="适合人格测试、共鸣表达和社交差异内容。",
                platform="小红书",
                focus="既要有共鸣标签，也要避免把人格固定化。",
            ),
            PresetScenario(
                slug="solo-date",
                title="高质量独处指南",
                description="适合 solo date、情绪恢复和自我陪伴内容。",
                platform="双平台",
                focus="强调细节感、仪式感和可持续的生活方法。",
            ),
            PresetScenario(
                slug="relationship-declutter",
                title="亲密关系断舍离",
                description="适合关系消耗、分开准备和自我保护内容。",
                platform="小红书",
                focus="避免极端煽动，突出边界、证据和自我照顾。",
            ),
            PresetScenario(
                slug="breakup-reset",
                title="分手重启节奏表",
                description="适合失恋后恢复、社交重建和情绪止损内容。",
                platform="抖音",
                focus="兼顾共情、步骤、情绪波动和恢复边界。",
            ),
            PresetScenario(
                slug="emotional-boundary",
                title="情绪边界表达模板",
                description="适合同事、朋友、伴侣之间的界限沟通内容。",
                platform="双平台",
                focus="把开口方式、措辞缓冲和底线表达写具体。",
            ),
            PresetScenario(
                slug="burnout-repair",
                title="职场情绪耗竭修复",
                description="适合 burnout、持续低能量和失去热情内容。",
                platform="小红书",
                focus="解释耗竭信号、恢复动作和寻求帮助的边界。",
            ),
            PresetScenario(
                slug="friendship-fallout",
                title="友情断裂后的复盘",
                description="适合朋友渐行渐远、误会和情绪收口内容。",
                platform="小红书",
                focus="保持克制，不妖魔化任何一方，给出收口动作。",
            ),
            PresetScenario(
                slug="therapy-journal",
                title="心理咨询笔记模板",
                description="适合做情绪观察、复盘记录和自我觉察内容。",
                platform="技术博客",
                focus="把情绪事件、触发点、身体反应和行动记录成结构。",
            ),
        ),
    ),
)


def _build_preset_template_seeds() -> tuple[PresetTemplateSeed, ...]:
    seeds: list[PresetTemplateSeed] = []
    for blueprint in CATEGORY_BLUEPRINTS:
        for index, scenario in enumerate(blueprint.scenarios, start=1):
            template_id = (
                scenario.template_id
                or f"template-preset-{blueprint.key}-{scenario.slug}"
            )
            seeds.append(
                PresetTemplateSeed(
                    id=template_id,
                    title=scenario.title,
                    description=scenario.description,
                    platform=scenario.platform,
                    category=blueprint.label,
                    knowledge_base_scope=scenario.knowledge_base_scope
                    or blueprint.knowledge_base_scope,
                    system_prompt=_build_system_prompt(blueprint, scenario),
                )
            )
    return tuple(seeds)


PRESET_TEMPLATE_SEEDS: tuple[PresetTemplateSeed, ...] = _build_preset_template_seeds()

PRESET_TEMPLATE_ORDER = {
    seed.id: index for index, seed in enumerate(PRESET_TEMPLATE_SEEDS)
}


def _apply_seed_to_template(template: Template, seed: PresetTemplateSeed) -> None:
    template.user_id = None
    template.title = seed.title
    template.description = seed.description
    template.platform = seed.platform
    template.category = seed.category
    template.knowledge_base_scope = seed.knowledge_base_scope
    template.system_prompt = seed.system_prompt
    template.is_preset = True


def ensure_preset_templates(db: Session) -> None:
    preset_ids = [seed.id for seed in PRESET_TEMPLATE_SEEDS]
    existing_templates = {
        template.id: template
        for template in db.scalars(
            select(Template).where(Template.id.in_(preset_ids))
        ).all()
    }

    has_changes = False

    for seed in PRESET_TEMPLATE_SEEDS:
        template = existing_templates.get(seed.id)
        if template is None:
            template = Template(id=seed.id)
            _apply_seed_to_template(template, seed)
            db.add(template)
            has_changes = True

    if has_changes:
        db.commit()
